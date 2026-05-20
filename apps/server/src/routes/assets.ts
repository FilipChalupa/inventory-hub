import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ASSET_STATUSES,
  assetCodeSchema,
  createAssetInput,
} from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { assetEvents, assetTypes, assets, orgSettings } from '../db/schema.js';
import { generateAssetCode } from '../lib/asset-code.js';

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

export const assetRoutes = new Hono<AppContext>()
  .get('/', zValidator('query', listQuery), (c) => {
    const db = c.get('db');
    const { q, status, includeArchived } = c.req.valid('query');

    const conditions = [];
    if (q) {
      conditions.push(or(like(assets.code, `%${q.toUpperCase()}%`), like(assets.name, `%${q}%`)));
    }
    if (status) conditions.push(eq(assets.status, status));
    if (!includeArchived) conditions.push(isNull(assets.archivedAt));

    const rows = db
      .select()
      .from(assets)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(assets.createdAt))
      .limit(200)
      .all();

    return c.json({ items: rows });
  })
  .get('/:code', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
    return c.json({ asset });
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
        typeId: input.typeId,
        locationId: input.locationId,
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
  });

export { assetCodeSchema };
