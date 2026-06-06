import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { asc, eq, like, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { contacts, loans } from '../db/schema.js';

const createInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  organization: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

const updateInput = createInput.partial();

export const contactRoutes = new Hono<AppContext>()
  .get('/', (c) => {
    const db = c.get('db');
    const q = c.req.query('q');
    const rows = db
      .select()
      .from(contacts)
      .where(
        q
          ? or(like(contacts.name, `%${q}%`), like(contacts.organization, `%${q}%`))
          : undefined,
      )
      .orderBy(asc(contacts.name))
      .all();
    return c.json({ items: rows });
  })
  .post('/', zValidator('json', createInput), (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const id = crypto.randomUUID();
    db.insert(contacts)
      .values({
        id,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        organization: input.organization ?? null,
        note: input.note ?? null,
      })
      .run();
    return c.json({ id, ...input }, 201);
  })
  .get('/:id', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const row = db.select().from(contacts).where(eq(contacts.id, id)).get();
    if (!row) return c.json({ error: { message: 'Kontakt nenalezen' } }, 404);
    // Recent loans for this contact — helps the operator see history.
    const recentLoans = db
      .select({
        id: loans.id,
        loanedAt: loans.loanedAt,
        expectedReturnAt: loans.expectedReturnAt,
        purpose: loans.purpose,
        borrowerName: loans.borrowerName,
      })
      .from(loans)
      .where(eq(loans.borrowerContactId, id))
      .orderBy(asc(loans.loanedAt))
      .limit(50)
      .all();
    return c.json({ contact: row, loans: recentLoans });
  })
  .patch('/:id', zValidator('json', updateInput), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const result = db
      .update(contacts)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .run();
    if (result.changes === 0) return c.json({ error: { message: 'Kontakt nenalezen' } }, 404);
    return c.json({ ok: true });
  })
  .delete('/:id', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const result = db.delete(contacts).where(eq(contacts.id, id)).run();
    if (result.changes === 0) return c.json({ error: { message: 'Kontakt nenalezen' } }, 404);
    return c.json({ ok: true });
  });
