import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  ASSET_STATUSES,
  TERMINAL_ASSET_STATUSES,
  createAssetInput,
  type AssetStatus,
} from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import {
  assetEvents,
  assetTypes,
  assets,
  orgSettings,
} from '../db/schema.js';
import { generateAssetCode } from '../lib/asset-code.js';

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
  name: z.string().min(1).max(200).optional(),
  typeId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const archiveInput = z.object({
  status: z.enum(TERMINAL_ASSET_STATUSES),
  note: z.string().max(500).optional(),
});

function isTerminalStatus(s: AssetStatus): boolean {
  return (TERMINAL_ASSET_STATUSES as readonly AssetStatus[]).includes(s);
}

export const assetRoutes = new Hono<AppContext>()
  .get('/', zValidator('query', listQuery), (c) => {
    const db = c.get('db');
    const { q, status, typeId, locationId, includeArchived } = c.req.valid('query');

    const conditions = [];
    if (q) {
      conditions.push(or(like(assets.code, `%${q.toUpperCase()}%`), like(assets.name, `%${q}%`)));
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

    const assetId = crypto.randomUUID();
    db.insert(assets)
      .values({
        id: assetId,
        code,
        name: input.name,
        typeId: input.typeId ?? null,
        locationId: input.locationId ?? null,
        customFields: input.customFields ?? {},
      })
      .run();

    db.insert(assetEvents)
      .values({
        assetId,
        actorUserId: null,
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

    db.update(assets)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(assets.id, asset.id))
      .run();

    db.insert(assetEvents)
      .values({
        assetId: asset.id,
        actorUserId: null,
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
        actorUserId: null,
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
        actorUserId: null,
        type: 'unarchived',
        payload: { previousStatus: asset.status },
      })
      .run();

    return c.json({ ok: true });
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
