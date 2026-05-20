import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { USER_ROLES } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { sessions, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const updateInput = z.object({
  role: z.enum(USER_ROLES).optional(),
  disabled: z.boolean().optional(),
});

export const userRoutes = new Hono<AppContext>()
  .get('/', requireAuth('admin', 'auditor'), (c) => {
    const db = c.get('db');
    const rows = db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        imageUrl: users.imageUrl,
        disabledAt: users.disabledAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.name))
      .all();
    return c.json({ items: rows });
  })
  .patch('/:id', requireAuth('admin'), zValidator('json', updateInput), (c) => {
    const db = c.get('db');
    const me = c.get('user')!;
    const id = c.req.param('id');
    const input = c.req.valid('json');

    if (id === me.id) {
      if (input.role && input.role !== 'admin') {
        return c.json({ error: { message: 'Nemůžeš si snížit vlastní roli' } }, 400);
      }
      if (input.disabled) {
        return c.json({ error: { message: 'Nemůžeš deaktivovat sám sebe' } }, 400);
      }
    }

    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) return c.json({ error: { message: 'Uživatel nenalezen' } }, 404);

    // If disabling, kill the user's sessions so they're logged out immediately.
    if (input.disabled === true && !target.disabledAt) {
      db.delete(sessions).where(eq(sessions.userId, id)).run();
    }

    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input.role !== undefined) patch.role = input.role;
    if (input.disabled !== undefined) {
      patch.disabledAt = input.disabled ? new Date() : null;
    }
    db.update(users).set(patch).where(eq(users.id, id)).run();
    return c.json({ ok: true });
  });
