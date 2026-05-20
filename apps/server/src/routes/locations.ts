import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { locations } from '../db/schema.js';

const createInput = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().nullable().optional(),
});

const updateInput = createInput.partial();

export const locationRoutes = new Hono<AppContext>()
  .get('/', (c) => {
    const db = c.get('db');
    const items = db.select().from(locations).orderBy(asc(locations.name)).all();
    return c.json({ items });
  })
  .post('/', zValidator('json', createInput), (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const id = crypto.randomUUID();
    db.insert(locations)
      .values({ id, name: input.name, parentId: input.parentId ?? null })
      .run();
    return c.json({ id, name: input.name, parentId: input.parentId ?? null }, 201);
  })
  .patch('/:id', zValidator('json', updateInput), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const result = db
      .update(locations)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(locations.id, id))
      .run();
    if (result.changes === 0) return c.json({ error: { message: 'Lokace nenalezena' } }, 404);
    return c.json({ ok: true });
  })
  .delete('/:id', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const result = db.delete(locations).where(eq(locations.id, id)).run();
    if (result.changes === 0) return c.json({ error: { message: 'Lokace nenalezena' } }, 404);
    return c.json({ ok: true });
  });
