import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_DAMAGE_PHOTOS, damageSeverities } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { assetEvents, assets, damageReports } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { emitWebhook } from '../lib/webhooks.js';

const createInput = z.object({
  occurredAt: z.coerce.date(),
  description: z.string().min(1).max(2000),
  severity: z.enum(damageSeverities),
  photoPaths: z
    .array(z.string())
    .max(MAX_DAMAGE_PHOTOS, `Maximálně ${MAX_DAMAGE_PHOTOS} fotek na hlášení.`)
    .optional(),
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

    const user = c.get('user')!;

    const id = crypto.randomUUID();
    db.insert(damageReports)
      .values({
        id,
        assetId: asset.id,
        occurredAt: input.occurredAt,
        reportedByUserId: user.id,
        description: input.description,
        severity: input.severity,
        photoPaths: input.photoPaths ?? [],
      })
      .run();

    // total severity → asset goes to `damaged`; otherwise asset stays in
    // its current status (we don't auto-flip to in_repair — that's an
    // explicit action). Only operators/admins may trigger this archive: a
    // plain member can report damage but must not be able to soft-delete any
    // asset by filing a `total` report (their report is still recorded for an
    // operator to act on).
    const canArchive = user.role === 'admin' || user.role === 'operator';
    if (input.severity === 'total' && asset.status !== 'damaged' && canArchive) {
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
        actorUserId: user.id,
        type: 'damage_reported',
        payload: { damageReportId: id, severity: input.severity },
      })
      .run();

    emitWebhook(db, 'damage.reported', {
      assetCode: asset.code,
      severity: input.severity,
      description: input.description,
    });

    return c.json({ id }, 201);
  })
  // Reporting a damage (POST /by-asset/:code) stays open to any signed-in
  // user (members report defects); resolving one is an operator action.
  .post('/:id/resolve', requireAuth('admin', 'operator'), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const report = db.select().from(damageReports).where(eq(damageReports.id, id)).get();
    if (!report) return c.json({ error: { message: 'Report nenalezen' } }, 404);
    db.update(damageReports).set({ resolvedAt: new Date() }).where(eq(damageReports.id, id)).run();
    db.insert(assetEvents)
      .values({
        assetId: report.assetId,
        actorUserId: c.get('user')?.id ?? null,
        type: 'damage_resolved',
        payload: { damageReportId: id, severity: report.severity },
      })
      .run();
    return c.json({ ok: true });
  });
