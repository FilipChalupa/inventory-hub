import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import {
  type ImportPayload,
  type UnresolvedReference,
  importPayloadSchema,
} from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import type { Db } from '../db/client.js';
import {
  assetEvents,
  assetExternalIds,
  assetTypes,
  assets,
  damageReports,
  loanItems,
  loans,
  locations,
} from '../db/schema.js';
import { mapWithConcurrency, storeRemoteFile } from '../lib/uploads.js';
import { requireAuth } from '../middleware/auth.js';

/** Thrown at the end of a dry-run transaction to roll everything back while
 * keeping the counts computed along the way. */
class DryRunRollback extends Error {}

const PHOTO_CONCURRENCY = 5;

/**
 * Generic bulk import in the Inventory Hub's own vocabulary — not tied to any
 * source system. The payload shape lives in `@inventory-hub/shared`
 * (`importPayloadSchema`) so the route validation and the OpenAPI docs can't
 * drift. Entities cross-reference each other by caller-provided natural keys
 * (`key` for types/locations, `code` for assets), and the endpoint assigns
 * real ids. Unlike the granular REST API it accepts explicit `status` /
 * `createdAt` / `archivedAt`, so historical data migrates faithfully.
 * Admin-only; idempotent on re-run (assets by code, types by code prefix /
 * name, locations by name).
 *
 * A source-specific adapter (e.g. the Kilomayo export in the monorepo) is
 * responsible for mapping its data into this format.
 *
 * Access: admin + operator (see the `requireAuth` guard on the route).
 */

type StructuredResult = {
  typeIdByKey: Map<string, string>;
  locationIdByKey: Map<string, string>;
  assetIdByCode: Map<string, string>;
  /** Assets actually inserted this run → eligible for photo download. */
  insertedAssetIdByCode: Map<string, string>;
  damageIdByAssetCode: Map<string, string>;
  unresolvedReferences: UnresolvedReference[];
  counts: {
    types: number;
    locations: number;
    assets: number;
    skippedAssets: number;
    loans: number;
    damages: number;
  };
};

function importStructured(
  db: Db,
  body: ImportPayload,
  actorUserId: string,
  dryRun: boolean,
): StructuredResult {
  const typeIdByCodePrefix = new Map<string, string>();
  const typeIdByName = new Map<string, string>();
  for (const t of db.select().from(assetTypes).all()) {
    typeIdByCodePrefix.set(t.codePrefix.toUpperCase(), t.id);
    typeIdByName.set(t.name, t.id);
  }
  const locationIdByName = new Map<string, string>();
  for (const l of db.select().from(locations).all()) {
    locationIdByName.set(l.name, l.id);
  }
  const existingCodes = new Set(
    db
      .select({ code: assets.code })
      .from(assets)
      .all()
      .map((r) => r.code),
  );

  const typeIdByKey = new Map<string, string>();
  const locationIdByKey = new Map<string, string>();
  const assetIdByCode = new Map<string, string>();
  const insertedAssetIdByCode = new Map<string, string>();
  const damageIdByAssetCode = new Map<string, string>();
  const unresolvedReferences: UnresolvedReference[] = [];
  const counts = { types: 0, locations: 0, assets: 0, skippedAssets: 0, loans: 0, damages: 0 };

  const locationDefByKey = new Map(body.locations.map((l) => [l.key, l]));

  try {
    db.transaction((tx) => {
      // Asset types — reuse existing by code prefix, then name.
      for (const t of body.assetTypes) {
        const existing =
          typeIdByCodePrefix.get(t.codePrefix.toUpperCase()) ?? typeIdByName.get(t.name);
        if (existing) {
          typeIdByKey.set(t.key, existing);
          continue;
        }
        const id = crypto.randomUUID();
        tx.insert(assetTypes)
          .values({
            id,
            name: t.name,
            codePrefix: t.codePrefix.toUpperCase(),
            customFieldsSchema: t.customFieldsSchema ?? [],
          })
          .run();
        typeIdByCodePrefix.set(t.codePrefix.toUpperCase(), id);
        typeIdByName.set(t.name, id);
        typeIdByKey.set(t.key, id);
        counts.types += 1;
      }

      // Locations — resolve parents recursively (deduped by name).
      const resolving = new Set<string>();
      const resolveLocation = (key: string): string | null => {
        const cached = locationIdByKey.get(key);
        if (cached) return cached;
        const def = locationDefByKey.get(key);
        if (!def) return null;
        if (resolving.has(key)) return null; // cycle guard
        resolving.add(key);
        const parentId = def.parentKey ? resolveLocation(def.parentKey) : null;
        resolving.delete(key);
        const existing = locationIdByName.get(def.name);
        if (existing) {
          locationIdByKey.set(key, existing);
          return existing;
        }
        const id = crypto.randomUUID();
        tx.insert(locations).values({ id, name: def.name, parentId }).run();
        locationIdByName.set(def.name, id);
        locationIdByKey.set(key, id);
        counts.locations += 1;
        return id;
      };
      for (const l of body.locations) resolveLocation(l.key);

      // Assets (+ events + external ids).
      for (const a of body.assets) {
        const code = a.code.toUpperCase();
        if (existingCodes.has(code)) {
          const existing = tx
            .select({ id: assets.id })
            .from(assets)
            .where(eq(assets.code, code))
            .get();
          if (existing) assetIdByCode.set(code, existing.id);
          counts.skippedAssets += 1;
          continue;
        }
        existingCodes.add(code);
        const typeId = a.typeKey ? (typeIdByKey.get(a.typeKey) ?? null) : null;
        if (a.typeKey && !typeId) {
          unresolvedReferences.push({ kind: 'type', value: a.typeKey, context: `asset ${code}` });
        }
        const locationId = a.locationKey ? (locationIdByKey.get(a.locationKey) ?? null) : null;
        if (a.locationKey && !locationId) {
          unresolvedReferences.push({
            kind: 'location',
            value: a.locationKey,
            context: `asset ${code}`,
          });
        }
        const id = crypto.randomUUID();
        tx.insert(assets)
          .values({
            id,
            code,
            name: a.name,
            typeId,
            locationId,
            status: a.status ?? 'in_stock',
            archivedAt: a.archivedAt ?? null,
            customFields: a.customFields ?? {},
            notes: a.notes ?? null,
            photoPaths: a.photoPaths ?? [],
            ...(a.createdAt ? { createdAt: a.createdAt } : {}),
          })
          .run();
        tx.insert(assetEvents)
          .values({
            assetId: id,
            actorUserId,
            type: 'created',
            payload: { code, source: 'import' },
            ...(a.createdAt ? { occurredAt: a.createdAt } : {}),
          })
          .run();
        for (const ext of a.externalIds ?? []) {
          const dup = tx
            .select({ id: assetExternalIds.id })
            .from(assetExternalIds)
            .where(and(eq(assetExternalIds.kind, ext.kind), eq(assetExternalIds.value, ext.value)))
            .get();
          if (dup) continue;
          tx.insert(assetExternalIds)
            .values({ id: crypto.randomUUID(), assetId: id, kind: ext.kind, value: ext.value })
            .run();
        }
        assetIdByCode.set(code, id);
        insertedAssetIdByCode.set(code, id);
        counts.assets += 1;
      }

      // Loans + items.
      for (const loan of body.loans) {
        const loanId = crypto.randomUUID();
        tx.insert(loans)
          .values({
            id: loanId,
            borrowerName: loan.borrowerName,
            borrowerContact: loan.borrowerContact ?? null,
            purpose: loan.purpose ?? null,
            ...(loan.loanedAt ? { loanedAt: loan.loanedAt } : {}),
            startedAt: loan.startedAt ?? null,
            expectedReturnAt: loan.expectedReturnAt ?? null,
            createdByUserId: actorUserId,
            ...(loan.createdAt ? { createdAt: loan.createdAt } : {}),
          })
          .run();
        for (const item of loan.items) {
          const assetId = assetIdByCode.get(item.assetCode.toUpperCase());
          if (!assetId) {
            unresolvedReferences.push({
              kind: 'asset',
              value: item.assetCode,
              context: `loan ${loan.borrowerName}`,
            });
            continue;
          }
          tx.insert(loanItems)
            .values({
              id: crypto.randomUUID(),
              loanId,
              assetId,
              returnedAt: item.returnedAt ?? null,
              returnCondition: item.returnCondition ?? null,
              returnNotes: item.returnNotes ?? null,
            })
            .run();
        }
        counts.loans += 1;
      }

      // Damage reports.
      for (const d of body.damages) {
        const assetId = assetIdByCode.get(d.assetCode.toUpperCase());
        if (!assetId) {
          unresolvedReferences.push({
            kind: 'asset',
            value: d.assetCode,
            context: `damage ${d.assetCode}`,
          });
          continue;
        }
        const id = crypto.randomUUID();
        tx.insert(damageReports)
          .values({
            id,
            assetId,
            occurredAt: d.occurredAt,
            reportedAt: d.reportedAt ?? d.occurredAt,
            reportedByUserId: actorUserId,
            description: d.description,
            severity: d.severity,
            resolvedAt: d.resolvedAt ?? null,
            photoPaths: d.photoPaths ?? [],
          })
          .run();
        damageIdByAssetCode.set(d.assetCode.toUpperCase(), id);
        counts.damages += 1;
      }

      // Roll the whole transaction back for a dry run — counts above are kept
      // (plain JS state), nothing is persisted.
      if (dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }

  return {
    typeIdByKey,
    locationIdByKey,
    assetIdByCode,
    insertedAssetIdByCode,
    damageIdByAssetCode,
    unresolvedReferences,
    counts,
  };
}

export const importRoutes = new Hono<AppContext>().post(
  '/',
  requireAuth('admin', 'operator'),
  zValidator('json', importPayloadSchema),
  async (c) => {
    const user = c.get('user')!;
    const db = c.get('db');
    const env = c.get('env');
    const body = c.req.valid('json');
    const dryRun = c.req.query('dryRun') === 'true';

    const result = importStructured(db, body, user.id, dryRun);

    if (dryRun) {
      return c.json({
        ok: true,
        dryRun: true,
        ...result.counts,
        photos: 0,
        photoFailures: [],
        unresolvedReferences: result.unresolvedReferences,
      });
    }

    // Photo pass — download every `photoUrls` entry across all inserted assets
    // and damage reports concurrently (with retry), then append the stored
    // paths to each target. Only targets we inserted this run are eligible, so
    // reruns don't re-download. URLs that fail after retries are reported.
    type PhotoTask = {
      table: 'asset' | 'damage';
      targetId: string;
      url: string;
    };
    const tasks: PhotoTask[] = [];
    for (const a of body.assets) {
      const targetId = result.insertedAssetIdByCode.get(a.code.toUpperCase());
      if (!targetId) continue;
      for (const url of a.photoUrls ?? []) tasks.push({ table: 'asset', targetId, url });
    }
    for (const d of body.damages) {
      const targetId = result.damageIdByAssetCode.get(d.assetCode.toUpperCase());
      if (!targetId) continue;
      for (const url of d.photoUrls ?? []) tasks.push({ table: 'damage', targetId, url });
    }

    const downloaded = await mapWithConcurrency(tasks, PHOTO_CONCURRENCY, (t) =>
      storeRemoteFile(env, t.url),
    );

    // Group successful paths per target (input order preserved) and report
    // failures.
    const photoFailures: string[] = [];
    const pathsByTarget = new Map<string, { table: 'asset' | 'damage'; paths: string[] }>();
    for (const [i, task] of tasks.entries()) {
      const rel = downloaded[i];
      if (!rel) {
        photoFailures.push(task.url);
        continue;
      }
      const entry = pathsByTarget.get(task.targetId) ?? { table: task.table, paths: [] };
      entry.paths.push(rel);
      pathsByTarget.set(task.targetId, entry);
    }

    let photos = 0;
    for (const [targetId, { table, paths }] of pathsByTarget) {
      if (table === 'asset') {
        const current = db
          .select({ photoPaths: assets.photoPaths })
          .from(assets)
          .where(eq(assets.id, targetId))
          .get();
        db.update(assets)
          .set({ photoPaths: [...(current?.photoPaths ?? []), ...paths], updatedAt: new Date() })
          .where(eq(assets.id, targetId))
          .run();
      } else {
        const current = db
          .select({ photoPaths: damageReports.photoPaths })
          .from(damageReports)
          .where(eq(damageReports.id, targetId))
          .get();
        db.update(damageReports)
          .set({ photoPaths: [...(current?.photoPaths ?? []), ...paths] })
          .where(eq(damageReports.id, targetId))
          .run();
      }
      photos += paths.length;
    }

    return c.json({
      ok: true,
      dryRun: false,
      ...result.counts,
      photos,
      photoFailures,
      unresolvedReferences: result.unresolvedReferences,
    });
  },
);
