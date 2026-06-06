import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  ASSET_STATUSES,
  TERMINAL_ASSET_STATUSES,
  assetCodeSchema,
  createAssetInput,
  validateCustomFieldValues,
  type AssetStatus,
  type CustomFieldsSchema,
} from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import {
  assetEvents,
  assetExternalIds,
  assetTypes,
  assets,
  orgSettings,
} from '../db/schema.js';
import { generateAssetCode } from '../lib/asset-code.js';
import { parseCsv } from '../lib/csv.js';
import type { Db } from '../db/client.js';

/**
 * Validates and normalizes custom field values against the schema attached
 * to the given asset type. Returns the cleaned values, or null when the
 * type has no schema. Throws a structured error when validation fails.
 */
function validateAssetCustomFields(
  db: Db,
  typeId: string | null,
  raw: Record<string, unknown> | undefined,
): { values: Record<string, unknown> } | { error: Record<string, string> } | { skip: true } {
  // No customFields key supplied → leave whatever is in DB unchanged.
  if (raw === undefined) return { skip: true };
  if (!typeId) {
    // No type = no schema to validate against; accept raw values as-is.
    return { values: raw };
  }
  const type = db.select().from(assetTypes).where(eq(assetTypes.id, typeId)).get();
  if (!type) return { values: raw };
  const schema = (type.customFieldsSchema ?? []) as CustomFieldsSchema;
  if (schema.length === 0) return { values: raw };
  const result = validateCustomFieldValues(schema, raw);
  if (!result.ok) return { error: result.errors };
  return { values: result.values };
}

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  typeId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

const updateInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  typeId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const archiveInput = z.object({
  status: z.enum(TERMINAL_ASSET_STATUSES),
  note: z.string().trim().max(500).optional(),
});

function isTerminalStatus(s: AssetStatus): boolean {
  return (TERMINAL_ASSET_STATUSES as readonly AssetStatus[]).includes(s);
}

/**
 * Increments the trailing sequence on an asset code like LAP-00007 → LAP-00008,
 * preserving the prefix and zero-padding.
 */
function incrementCode(code: string): string {
  const lastDash = code.lastIndexOf('-');
  const prefix = code.slice(0, lastDash + 1);
  const seqStr = code.slice(lastDash + 1);
  const next = String(Number(seqStr) + 1).padStart(seqStr.length, '0');
  return `${prefix}${next}`;
}

export const assetRoutes = new Hono<AppContext>()
  .get('/', zValidator('query', listQuery), (c) => {
    const db = c.get('db');
    const { q, status, typeId, locationId, includeArchived } = c.req.valid('query');

    const conditions = [];
    if (q) {
      // Search across code, name, JSON-encoded custom_fields, and the
      // dedicated asset_external_ids table (so a scanned serial number
      // resolves to its asset from the same search box).
      const matchingByExternal = db
        .select({ assetId: assetExternalIds.assetId })
        .from(assetExternalIds)
        .where(like(assetExternalIds.value, `%${q}%`))
        .all();
      const externalIds = matchingByExternal.map((r) => r.assetId);
      conditions.push(
        or(
          like(assets.code, `%${q.toUpperCase()}%`),
          like(assets.name, `%${q}%`),
          like(assets.customFields, `%${q}%`),
          externalIds.length > 0 ? inArray(assets.id, externalIds) : sql`0`,
        ),
      );
    }
    if (status) conditions.push(eq(assets.status, status));
    if (typeId) conditions.push(eq(assets.typeId, typeId));
    if (locationId) conditions.push(eq(assets.locationId, locationId));
    if (!includeArchived) conditions.push(isNull(assets.archivedAt));

    const rows = db
      .select()
      .from(assets)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(assets.createdAt))
      .limit(500)
      .all();

    return c.json({ items: rows });
  })
  .post('/', zValidator('json', createAssetInput), (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');

    let code = input.code?.toUpperCase();
    if (!code) {
      if (!input.typeId) {
        return c.json(
          { error: { message: 'Bez kódu vyžadujeme typ assetu (z něj se odvodí prefix)' } },
          400,
        );
      }
      const type = db.select().from(assetTypes).where(eq(assetTypes.id, input.typeId)).get();
      if (!type) return c.json({ error: { message: 'Typ nenalezen' } }, 400);
      const org = db.select().from(orgSettings).where(eq(orgSettings.id, 'singleton')).get();
      code = generateAssetCode(db, type.codePrefix, org?.codePrefix ?? null);
    }

    const existing = db.select({ id: assets.id }).from(assets).where(eq(assets.code, code)).get();
    if (existing) return c.json({ error: { message: `Kód ${code} už existuje` } }, 409);

    // On create, treat missing customFields as empty (so required-field
    // validation still triggers).
    const cfResult = validateAssetCustomFields(
      db,
      input.typeId ?? null,
      input.customFields ?? {},
    );
    if ('error' in cfResult) {
      return c.json({ error: { message: 'Neplatná vlastní pole', fields: cfResult.error } }, 400);
    }
    const customFields = 'skip' in cfResult ? {} : cfResult.values;

    const assetId = crypto.randomUUID();
    db.insert(assets)
      .values({
        id: assetId,
        code,
        name: input.name,
        typeId: input.typeId ?? null,
        locationId: input.locationId ?? null,
        customFields,
      })
      .run();

    db.insert(assetEvents)
      .values({
        assetId,
        actorUserId: c.get('user')?.id ?? null,
        type: 'created',
        payload: { code, name: input.name },
      })
      .run();

    return c.json({ code, id: assetId }, 201);
  })
  .get('/:code', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
    return c.json({ asset });
  })
  .patch('/:code', zValidator('json', updateInput), (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const input = c.req.valid('json');
    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);

    // If customFields are being updated, validate against the (possibly new) type's schema.
    let patch: typeof input = { ...input };
    if (input.customFields !== undefined) {
      const targetTypeId =
        input.typeId !== undefined ? input.typeId : asset.typeId;
      const cfResult = validateAssetCustomFields(db, targetTypeId, input.customFields);
      if ('error' in cfResult) {
        return c.json({ error: { message: 'Neplatná vlastní pole', fields: cfResult.error } }, 400);
      }
      patch = { ...input, customFields: 'skip' in cfResult ? {} : cfResult.values };
    }

    db.update(assets)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(assets.id, asset.id))
      .run();

    db.insert(assetEvents)
      .values({
        assetId: asset.id,
        actorUserId: c.get('user')?.id ?? null,
        type: 'updated',
        payload: input as Record<string, unknown>,
      })
      .run();

    return c.json({ ok: true });
  })
  .post('/:code/archive', zValidator('json', archiveInput), (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const input = c.req.valid('json');
    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);

    db.update(assets)
      .set({
        status: input.status,
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(assets.id, asset.id))
      .run();

    db.insert(assetEvents)
      .values({
        assetId: asset.id,
        actorUserId: c.get('user')?.id ?? null,
        type: 'archived',
        payload: { status: input.status, note: input.note },
      })
      .run();

    return c.json({ ok: true });
  })
  .post('/:code/unarchive', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
    if (!isTerminalStatus(asset.status)) {
      return c.json({ error: { message: 'Asset není archivovaný' } }, 400);
    }

    db.update(assets)
      .set({
        status: 'in_stock',
        archivedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, asset.id))
      .run();

    db.insert(assetEvents)
      .values({
        assetId: asset.id,
        actorUserId: c.get('user')?.id ?? null,
        type: 'unarchived',
        payload: { previousStatus: asset.status },
      })
      .run();

    return c.json({ ok: true });
  })
  .post(
    '/:code/photos',
    zValidator('json', z.object({ path: z.string().min(1).max(500) })),
    (c) => {
      const db = c.get('db');
      const code = c.req.param('code').toUpperCase();
      const { path } = c.req.valid('json');
      const asset = db.select().from(assets).where(eq(assets.code, code)).get();
      if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
      const existing = (asset.photoPaths ?? []) as string[];
      if (existing.includes(path)) {
        return c.json({ photoPaths: existing });
      }
      const next = [...existing, path];
      db.update(assets)
        .set({ photoPaths: next, updatedAt: new Date() })
        .where(eq(assets.id, asset.id))
        .run();
      db.insert(assetEvents)
        .values({
          assetId: asset.id,
          actorUserId: c.get('user')?.id ?? null,
          type: 'updated',
          payload: { photo: { path, op: 'added' } },
        })
        .run();
      return c.json({ photoPaths: next });
    },
  )
  .delete(
    '/:code/photos',
    zValidator('json', z.object({ path: z.string() })),
    (c) => {
      const db = c.get('db');
      const code = c.req.param('code').toUpperCase();
      const { path } = c.req.valid('json');
      const asset = db.select().from(assets).where(eq(assets.code, code)).get();
      if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
      const before = (asset.photoPaths ?? []) as string[];
      const next = before.filter((p) => p !== path);
      db.update(assets)
        .set({ photoPaths: next, updatedAt: new Date() })
        .where(eq(assets.id, asset.id))
        .run();
      if (before.length !== next.length) {
        db.insert(assetEvents)
          .values({
            assetId: asset.id,
            actorUserId: c.get('user')?.id ?? null,
            type: 'updated',
            payload: { photo: { path, op: 'removed' } },
          })
          .run();
      }
      return c.json({ photoPaths: next });
    },
  )
  .post(
    '/:code/documents',
    zValidator('json', z.object({ path: z.string().min(1).max(500) })),
    (c) => {
      const db = c.get('db');
      const code = c.req.param('code').toUpperCase();
      const { path } = c.req.valid('json');
      const asset = db.select().from(assets).where(eq(assets.code, code)).get();
      if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
      const existing = (asset.documentPaths ?? []) as string[];
      if (existing.includes(path)) {
        return c.json({ documentPaths: existing });
      }
      const next = [...existing, path];
      db.update(assets)
        .set({ documentPaths: next, updatedAt: new Date() })
        .where(eq(assets.id, asset.id))
        .run();
      db.insert(assetEvents)
        .values({
          assetId: asset.id,
          actorUserId: c.get('user')?.id ?? null,
          type: 'updated',
          payload: { document: { path, op: 'added' } },
        })
        .run();
      return c.json({ documentPaths: next });
    },
  )
  .delete(
    '/:code/documents',
    zValidator('json', z.object({ path: z.string() })),
    (c) => {
      const db = c.get('db');
      const code = c.req.param('code').toUpperCase();
      const { path } = c.req.valid('json');
      const asset = db.select().from(assets).where(eq(assets.code, code)).get();
      if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
      const before = (asset.documentPaths ?? []) as string[];
      const next = before.filter((p) => p !== path);
      db.update(assets)
        .set({ documentPaths: next, updatedAt: new Date() })
        .where(eq(assets.id, asset.id))
        .run();
      if (before.length !== next.length) {
        db.insert(assetEvents)
          .values({
            assetId: asset.id,
            actorUserId: c.get('user')?.id ?? null,
            type: 'updated',
            payload: { document: { path, op: 'removed' } },
          })
          .run();
      }
      return c.json({ documentPaths: next });
    },
  )
  .post(
    '/:code/assign',
    zValidator('json', z.object({ userId: z.string().uuid() })),
    (c) => {
      const db = c.get('db');
      const code = c.req.param('code').toUpperCase();
      const { userId } = c.req.valid('json');
      const asset = db.select().from(assets).where(eq(assets.code, code)).get();
      if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
      if (asset.archivedAt) {
        return c.json({ error: { message: 'Archivovaný asset nelze přiřadit' } }, 409);
      }
      if (asset.status === 'on_loan') {
        return c.json({ error: { message: 'Vypůjčený asset nelze přiřadit interně' } }, 409);
      }
      db.update(assets)
        .set({
          assignedToUserId: userId,
          status: 'assigned',
          updatedAt: new Date(),
        })
        .where(eq(assets.id, asset.id))
        .run();
      db.insert(assetEvents)
        .values({
          assetId: asset.id,
          actorUserId: c.get('user')?.id ?? null,
          type: 'assigned',
          payload: { userId },
        })
        .run();
      return c.json({ ok: true });
    },
  )
  .post('/:code/repair-start', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
    if (asset.archivedAt) {
      return c.json({ error: { message: 'Archivovaný asset nelze poslat do opravy' } }, 409);
    }
    if (asset.status === 'on_loan') {
      return c.json({ error: { message: 'Vypůjčený asset nelze poslat do opravy' } }, 409);
    }
    if (asset.status === 'in_repair') {
      return c.json({ error: { message: 'Asset už je v opravě' } }, 409);
    }
    db.update(assets)
      .set({ status: 'in_repair', updatedAt: new Date() })
      .where(eq(assets.id, asset.id))
      .run();
    db.insert(assetEvents)
      .values({
        assetId: asset.id,
        actorUserId: c.get('user')?.id ?? null,
        type: 'repair_started',
        payload: { previousStatus: asset.status },
      })
      .run();
    return c.json({ ok: true });
  })
  .post('/:code/repair-finish', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
    if (asset.status !== 'in_repair') {
      return c.json({ error: { message: 'Asset není v opravě' } }, 409);
    }
    db.update(assets)
      .set({ status: 'in_stock', updatedAt: new Date() })
      .where(eq(assets.id, asset.id))
      .run();
    db.insert(assetEvents)
      .values({
        assetId: asset.id,
        actorUserId: c.get('user')?.id ?? null,
        type: 'repair_finished',
        payload: {},
      })
      .run();
    return c.json({ ok: true });
  })
  .post('/:code/unassign', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
    if (asset.status !== 'assigned') {
      return c.json({ error: { message: 'Asset není interně přiřazený' } }, 409);
    }
    db.update(assets)
      .set({
        assignedToUserId: null,
        status: 'in_stock',
        updatedAt: new Date(),
      })
      .where(eq(assets.id, asset.id))
      .run();
    db.insert(assetEvents)
      .values({
        assetId: asset.id,
        actorUserId: c.get('user')?.id ?? null,
        type: 'unassigned',
        payload: { previousAssignee: asset.assignedToUserId },
      })
      .run();
    return c.json({ ok: true });
  })
  .get('/:code/external-ids', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
    const items = db
      .select()
      .from(assetExternalIds)
      .where(eq(assetExternalIds.assetId, asset.id))
      .orderBy(asc(assetExternalIds.kind), asc(assetExternalIds.value))
      .all();
    return c.json({ items });
  })
  .post(
    '/:code/external-ids',
    zValidator(
      'json',
      z.object({
        kind: z.string().min(1).max(40),
        value: z.string().min(1).max(200),
      }),
    ),
    (c) => {
      const db = c.get('db');
      const code = c.req.param('code').toUpperCase();
      const input = c.req.valid('json');
      const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.code, code)).get();
      if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);

      const existing = db
        .select({ id: assetExternalIds.id, assetId: assetExternalIds.assetId })
        .from(assetExternalIds)
        .where(and(eq(assetExternalIds.kind, input.kind), eq(assetExternalIds.value, input.value)))
        .get();
      if (existing) {
        return c.json(
          {
            error: {
              message:
                existing.assetId === asset.id
                  ? 'Tento identifikátor je už přiřazen tomuto assetu'
                  : 'Tento identifikátor patří jinému assetu',
            },
          },
          409,
        );
      }

      const id = crypto.randomUUID();
      db.insert(assetExternalIds)
        .values({ id, assetId: asset.id, kind: input.kind, value: input.value })
        .run();
      db.insert(assetEvents)
        .values({
          assetId: asset.id,
          actorUserId: c.get('user')?.id ?? null,
          type: 'updated',
          payload: { externalId: { kind: input.kind, value: input.value, op: 'added' } },
        })
        .run();
      return c.json({ id, kind: input.kind, value: input.value }, 201);
    },
  )
  .delete('/:code/external-ids/:id', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const id = c.req.param('id');
    const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
    const result = db
      .delete(assetExternalIds)
      .where(and(eq(assetExternalIds.id, id), eq(assetExternalIds.assetId, asset.id)))
      .run();
    if (result.changes === 0) {
      return c.json({ error: { message: 'Identifikátor nenalezen' } }, 404);
    }
    db.insert(assetEvents)
      .values({
        assetId: asset.id,
        actorUserId: c.get('user')?.id ?? null,
        type: 'updated',
        payload: { externalId: { id, op: 'removed' } },
      })
      .run();
    return c.json({ ok: true });
  })
  .get('/events/all', (c) => {
    const db = c.get('db');
    const limit = Math.min(Number(c.req.query('limit') ?? '200') || 200, 500);
    const rows = db
      .select({
        id: assetEvents.id,
        assetId: assetEvents.assetId,
        actorUserId: assetEvents.actorUserId,
        type: assetEvents.type,
        payload: assetEvents.payload,
        occurredAt: assetEvents.occurredAt,
        assetCode: assets.code,
        assetName: assets.name,
      })
      .from(assetEvents)
      .leftJoin(assets, eq(assetEvents.assetId, assets.id))
      .orderBy(desc(assetEvents.occurredAt))
      .limit(limit)
      .all();
    return c.json({ items: rows });
  })
  .get('/:code/events', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
    const items = db
      .select()
      .from(assetEvents)
      .where(eq(assetEvents.assetId, asset.id))
      .orderBy(desc(assetEvents.occurredAt))
      .limit(200)
      .all();
    return c.json({ items });
  })
  .get('/:code/qr', async (c) => {
    const env = c.get('env');
    const code = c.req.param('code').toUpperCase();
    const url = `${env.PUBLIC_APP_URL}/a/${code}`;
    const png = await QRCode.toBuffer(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
    });
    return new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  })
  .post('/import', async (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    if (user.role !== 'admin' && user.role !== 'operator') {
      return c.json({ error: { message: 'Pouze admin nebo operator může importovat' } }, 403);
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: { message: 'Neplatná multipart data' } }, 400);
    }
    const file = form.get('file');
    const dryRun = form.get('dryRun') === 'true';
    if (!(file instanceof File)) {
      return c.json({ error: { message: 'Pole „file" je povinné' } }, 400);
    }
    if (file.size > 1_000_000) {
      return c.json({ error: { message: 'CSV soubor je větší než 1 MB' } }, 413);
    }
    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    if (rows.length === 0) {
      return c.json({ error: { message: 'CSV je prázdné (žádné datové řádky)' } }, 400);
    }
    if (rows.length > 1000) {
      return c.json({ error: { message: 'Maximálně 1000 řádků na import' } }, 400);
    }

    const required = ['name'];
    const knownHeaders = new Set(['code', 'name', 'type', 'notes']);
    const customFieldHeaders = headers.filter((h) => !knownHeaders.has(h));
    for (const r of required) {
      if (!headers.includes(r)) {
        return c.json({ error: { message: `Chybí povinný sloupec: ${r}` } }, 400);
      }
    }

    // Cache asset types by prefix.
    const typesByPrefix = new Map<string, (typeof assetTypes.$inferSelect)>();
    for (const t of db.select().from(assetTypes).all()) {
      typesByPrefix.set(t.codePrefix.toUpperCase(), t);
    }
    const org = db.select().from(orgSettings).where(eq(orgSettings.id, 'singleton')).get();
    const orgPrefix = org?.codePrefix ?? null;

    type PreviewRow = {
      lineNumber: number;
      input: Record<string, string>;
      code: string | null;
      issues: string[];
    };
    const preview: PreviewRow[] = [];
    const seenCodes = new Set<string>();
    const usedCodesInRun = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const issues: string[] = [];
      const name = row['name'] ?? '';
      const codeRaw = (row['code'] ?? '').trim().toUpperCase();
      const typePrefix = (row['type'] ?? '').trim().toUpperCase();
      const type = typePrefix ? typesByPrefix.get(typePrefix) : null;

      if (!name) issues.push('Chybí name');
      if (codeRaw) {
        const parsed = assetCodeSchema.safeParse(codeRaw);
        if (!parsed.success) issues.push('Neplatný code (formát PREFIX-…-…)');
      }
      if (!codeRaw && !type) {
        issues.push('Bez code je povinný sloupec „type" (codePrefix existujícího typu)');
      }
      if (typePrefix && !type) {
        issues.push(`Typ s prefixem „${typePrefix}" neexistuje`);
      }

      // Compute final code (may be generated only at commit-time; for preview
      // we approximate by counting collisions inside the CSV itself).
      let finalCode: string | null = null;
      if (codeRaw) {
        finalCode = codeRaw;
        if (usedCodesInRun.has(codeRaw)) issues.push('Duplicitní code v CSV');
        else usedCodesInRun.add(codeRaw);
        // Check DB collision
        const existing = db
          .select({ id: assets.id })
          .from(assets)
          .where(eq(assets.code, codeRaw))
          .get();
        if (existing) issues.push(`Code ${codeRaw} už v databázi existuje`);
      }

      // Validate custom fields against schema if a type is resolved.
      if (type && customFieldHeaders.length > 0) {
        const raw: Record<string, unknown> = {};
        for (const h of customFieldHeaders) {
          const v = row[h];
          if (v !== undefined && v !== '') raw[h] = v;
        }
        const schema = (type.customFieldsSchema ?? []) as CustomFieldsSchema;
        if (schema.length > 0) {
          const r = validateCustomFieldValues(schema, raw);
          if (!r.ok) {
            for (const [k, msg] of Object.entries(r.errors)) {
              issues.push(`${k}: ${msg}`);
            }
          }
        }
      }

      preview.push({ lineNumber: i + 2, input: row, code: finalCode, issues });
      if (finalCode) seenCodes.add(finalCode);
    }

    const hasErrors = preview.some((p) => p.issues.length > 0);
    if (dryRun || hasErrors) {
      return c.json({ preview, hasErrors, created: 0 }, hasErrors && !dryRun ? 400 : 200);
    }

    // Pre-compute auto-generated codes outside the transaction so we
    // can stay on the typed Db handle. Per type we query the DB max once
    // then increment locally across rows that need a code.
    const assignedCodes = new Map<number, string>(); // preview index → code
    const counters = new Map<string, string>(); // codePrefix → last code
    for (let idx = 0; idx < preview.length; idx++) {
      const p = preview[idx]!;
      if (p.code || p.issues.length > 0) continue;
      const typePrefix = (p.input['type'] ?? '').trim().toUpperCase();
      const type = typePrefix ? typesByPrefix.get(typePrefix) : null;
      if (!type) continue;
      let lastCode = counters.get(type.codePrefix);
      const nextCode = lastCode
        ? incrementCode(lastCode)
        : generateAssetCode(db, type.codePrefix, orgPrefix);
      counters.set(type.codePrefix, nextCode);
      assignedCodes.set(idx, nextCode);
    }

    let created = 0;
    db.transaction((tx) => {
      for (let idx = 0; idx < preview.length; idx++) {
        const p = preview[idx]!;
        const row = p.input;
        const typePrefix = (row['type'] ?? '').trim().toUpperCase();
        const type = typePrefix ? typesByPrefix.get(typePrefix) : null;
        const code = p.code ?? assignedCodes.get(idx) ?? null;
        if (!code) continue;
        const customFields: Record<string, unknown> = {};
        if (type) {
          for (const h of customFieldHeaders) {
            const v = row[h];
            if (v !== undefined && v !== '') customFields[h] = v;
          }
        }
        const id = crypto.randomUUID();
        tx.insert(assets)
          .values({
            id,
            code,
            name: row['name']!,
            typeId: type?.id ?? null,
            notes: row['notes'] || null,
            customFields,
          })
          .run();
        tx.insert(assetEvents)
          .values({
            assetId: id,
            actorUserId: user.id,
            type: 'created',
            payload: { code, source: 'import' },
          })
          .run();
        created += 1;
      }
    });

    return c.json({ preview, hasErrors: false, created });
  })
  .post('/labels', zValidator('json', z.object({ codes: z.array(z.string()).min(1).max(100) })), (c) => {
    const db = c.get('db');
    const env = c.get('env');
    const codes = c.req.valid('json').codes.map((x) => x.toUpperCase());
    const rows = db
      .select({ code: assets.code, name: assets.name })
      .from(assets)
      .where(inArray(assets.code, codes))
      .orderBy(asc(assets.code))
      .all();
    return c.json({
      items: rows.map((r) => ({
        code: r.code,
        name: r.name,
        qrUrl: `${env.PUBLIC_APP_URL}/a/${r.code}`,
      })),
    });
  });

export { listQuery as assetListQuery };
// silence unused warning for typed re-exports used elsewhere
void sql;
