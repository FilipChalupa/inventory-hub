import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { Db } from '../db/client.js';
import { locations } from '../db/schema.js';

const createInput = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().nullable().optional(),
});

const updateInput = createInput.partial();

/**
 * True when moving `nodeId` under `newParentId` would create a cycle —
 * i.e. `newParentId` is `nodeId` itself or a descendant of `nodeId`.
 */
function wouldCreateCycle(db: Db, nodeId: string, newParentId: string): boolean {
  if (nodeId === newParentId) return true;
  const all = db
    .select({ id: locations.id, parentId: locations.parentId })
    .from(locations)
    .all();
  const parentOf = new Map(all.map((r) => [r.id, r.parentId] as const));
  let cursor: string | null = newParentId;
  const guard = new Set<string>();
  while (cursor) {
    if (cursor === nodeId) return true;
    if (guard.has(cursor)) return true; // existing cycle — treat as unsafe
    guard.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

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
    if (input.parentId !== undefined && input.parentId !== null) {
      const parent = db.select().from(locations).where(eq(locations.id, input.parentId)).get();
      if (!parent) return c.json({ error: { message: 'Cílová lokace neexistuje' } }, 400);
      if (wouldCreateCycle(db, id, input.parentId)) {
        return c.json({ error: { message: 'Přesun by vytvořil cyklus' } }, 409);
      }
    }
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
