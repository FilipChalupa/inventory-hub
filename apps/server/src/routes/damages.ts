import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { damageSeverities } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { assetEvents, assets, damageReports, users } from '../db/schema.js';

const createInput = z.object({
  occurredAt: z.coerce.date(),
  description: z.string().min(1).max(2000),
  severity: z.enum(damageSeverities),
  photoPaths: z.array(z.string()).max(20).optional(),
});

export const damageRoutes = new Hono<AppContext>()
  .get('/by-asset/:code', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);
    const items = db
      .select()
      .from(damageReports)
      .where(eq(damageReports.assetId, asset.id))
      .orderBy(desc(damageReports.occurredAt))
      .all();
    return c.json({ items });
  })
  .post('/by-asset/:code', zValidator('json', createInput), (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const input = c.req.valid('json');

    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);

    // FIXME(auth): until auth is wired, fall back to the dev admin
    const fallback = db.select().from(users).orderBy(users.createdAt).get();
    if (!fallback) {
      return c.json({ error: { message: 'Žádný uživatel v systému, nelze zapsat report' } }, 400);
    }

    const id = crypto.randomUUID();
    db.insert(damageReports)
      .values({
        id,
        assetId: asset.id,
        occurredAt: input.occurredAt,
        reportedByUserId: fallback.id,
        description: input.description,
        severity: input.severity,
        photoPaths: input.photoPaths ?? [],
      })
      .run();

    // total severity → asset goes to `damaged`; otherwise asset stays in
    // its current status (we don't auto-flip to in_repair — that's an
    // explicit action).
    if (input.severity === 'total' && asset.status !== 'damaged') {
      db.update(assets)
        .set({
          status: 'damaged',
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(assets.id, asset.id))
        .run();
    }

    db.insert(assetEvents)
      .values({
        assetId: asset.id,
        actorUserId: fallback.id,
        type: 'damage_reported',
        payload: { damageReportId: id, severity: input.severity },
      })
      .run();

    return c.json({ id }, 201);
  })
  .post('/:id/resolve', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const result = db
      .update(damageReports)
      .set({ resolvedAt: new Date() })
      .where(eq(damageReports.id, id))
      .run();
    if (result.changes === 0) return c.json({ error: { message: 'Report nenalezen' } }, 404);
    return c.json({ ok: true });
  });
