import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ASSET_STATUSES, damageSeverities } from '@inventory-hub/shared';
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
import { storeRemoteFile } from '../lib/uploads.js';

/**
 * Generic bulk import in the Inventory Hub's own vocabulary — not tied to any
 * source system. Entities cross-reference each other by caller-provided
 * natural keys (`key` for types/locations, `code` for assets), and the
 * endpoint assigns real ids. Unlike the granular REST API it accepts explicit
 * `status` / `createdAt` / `archivedAt`, so historical data migrates
 * faithfully. Admin-only; idempotent on re-run (assets by code, types by code
 * prefix / name, locations by name).
 *
 * A source-specific adapter (e.g. the Kilomayo export in the monorepo) is
 * responsible for mapping its data into this format.
 */

const customFieldDef = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'date', 'boolean', 'select']),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

const importType = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  codePrefix: z.string().min(1),
  customFieldsSchema: z.array(customFieldDef).optional(),
});

const importLocation = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  parentKey: z.string().nullish(),
});

const importAsset = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  typeKey: z.string().nullish(),
  locationKey: z.string().nullish(),
  status: z.enum(ASSET_STATUSES).optional(),
  archivedAt: z.coerce.date().nullish(),
  createdAt: z.coerce.date().nullish(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().nullish(),
  externalIds: z.array(z.object({ kind: z.string().min(1), value: z.string().min(1) })).optional(),
  photoUrls: z.array(z.string().url()).optional(),
});

const importLoan = z.object({
  borrowerName: z.string().min(1),
  borrowerContact: z.string().nullish(),
  purpose: z.string().nullish(),
  loanedAt: z.coerce.date().optional(),
  startedAt: z.coerce.date().nullish(),
  expectedReturnAt: z.coerce.date().nullish(),
  createdAt: z.coerce.date().optional(),
  items: z
    .array(
      z.object({
        assetCode: z.string().min(1),
        returnedAt: z.coerce.date().nullish(),
        returnCondition: z.enum(['ok', 'damaged']).nullish(),
        returnNotes: z.string().nullish(),
      }),
    )
    .min(1),
});

const importDamage = z.object({
  assetCode: z.string().min(1),
  occurredAt: z.coerce.date(),
  reportedAt: z.coerce.date().optional(),
  description: z.string().min(1),
  severity: z.enum(damageSeverities),
  resolvedAt: z.coerce.date().nullish(),
  photoUrls: z.array(z.string().url()).optional(),
});

const importBody = z.object({
  version: z.literal(1),
  assetTypes: z.array(importType).default([]),
  locations: z.array(importLocation).default([]),
  assets: z.array(importAsset).default([]),
  loans: z.array(importLoan).default([]),
  damages: z.array(importDamage).default([]),
});

type ImportBody = z.infer<typeof importBody>;

type StructuredResult = {
  typeIdByKey: Map<string, string>;
  locationIdByKey: Map<string, string>;
  assetIdByCode: Map<string, string>;
  /** Assets actually inserted this run → eligible for photo download. */
  insertedAssetIdByCode: Map<string, string>;
  damageIdByAssetCode: Map<string, string>;
  counts: {
    types: number;
    locations: number;
    assets: number;
    skippedAssets: number;
    loans: number;
    damages: number;
  };
};

function importStructured(db: Db, body: ImportBody, actorUserId: string): StructuredResult {
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
  const counts = { types: 0, locations: 0, assets: 0, skippedAssets: 0, loans: 0, damages: 0 };

  const locationDefByKey = new Map(body.locations.map((l) => [l.key, l]));

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
      const typeId = a.typeKey ? typeIdByKey.get(a.typeKey) ?? null : null;
      const locationId = a.locationKey ? locationIdByKey.get(a.locationKey) ?? null : null;
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
        if (!assetId) continue;
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
      if (!assetId) continue;
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
        })
        .run();
      damageIdByAssetCode.set(d.assetCode.toUpperCase(), id);
      counts.damages += 1;
    }
  });

  return {
    typeIdByKey,
    locationIdByKey,
    assetIdByCode,
    insertedAssetIdByCode,
    damageIdByAssetCode,
    counts,
  };
}

export const importRoutes = new Hono<AppContext>().post(
  '/',
  zValidator('json', importBody),
  async (c) => {
    const user = c.get('user')!;
    if (user.role !== 'admin') {
      return c.json({ error: { message: 'Pouze admin může importovat' } }, 403);
    }
    const db = c.get('db');
    const env = c.get('env');
    const body = c.req.valid('json');

    const result = importStructured(db, body, user.id);

    // Photo pass (async; outside the sync transaction). Only for assets we
    // actually inserted, so reruns don't duplicate downloads.
    let photos = 0;
    for (const a of body.assets) {
      if (!a.photoUrls?.length) continue;
      const assetId = result.insertedAssetIdByCode.get(a.code.toUpperCase());
      if (!assetId) continue;
      const paths: string[] = [];
      for (const url of a.photoUrls) {
        const rel = await storeRemoteFile(env, url);
        if (rel) paths.push(rel);
      }
      if (paths.length === 0) continue;
      db.update(assets)
        .set({ photoPaths: paths, updatedAt: new Date() })
        .where(eq(assets.id, assetId))
        .run();
      photos += paths.length;
    }
    for (const d of body.damages) {
      if (!d.photoUrls?.length) continue;
      const damageId = result.damageIdByAssetCode.get(d.assetCode.toUpperCase());
      if (!damageId) continue;
      const paths: string[] = [];
      for (const url of d.photoUrls) {
        const rel = await storeRemoteFile(env, url);
        if (rel) paths.push(rel);
      }
      if (paths.length === 0) continue;
      db.update(damageReports)
        .set({ photoPaths: paths })
        .where(eq(damageReports.id, damageId))
        .run();
      photos += paths.length;
    }

    return c.json({ ok: true, ...result.counts, photos });
  },
);
