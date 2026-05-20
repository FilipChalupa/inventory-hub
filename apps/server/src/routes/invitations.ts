import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { USER_ROLES } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { invitations, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { ConsoleEmailSender } from '../lib/email.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const emailSender = new ConsoleEmailSender();

const createInput = z.object({
  email: z.string().email(),
  role: z.enum(USER_ROLES),
});

export const invitationRoutes = new Hono<AppContext>()
  .get('/', requireAuth('admin'), (c) => {
    const db = c.get('db');
    const rows = db
      .select()
      .from(invitations)
      .where(isNull(invitations.acceptedAt))
      .orderBy(desc(invitations.createdAt))
      .all();
    return c.json({ items: rows });
  })
  .post('/', requireAuth('admin'), zValidator('json', createInput), async (c) => {
    const db = c.get('db');
    const env = c.get('env');
    const me = c.get('user')!;
    const input = c.req.valid('json');
    const email = input.email.toLowerCase();

    const existing = db.select().from(users).where(eq(users.email, email)).get();
    if (existing) {
      return c.json({ error: { message: `Uživatel s e-mailem ${email} už existuje` } }, 409);
    }
    const pending = db
      .select({ id: invitations.id })
      .from(invitations)
      .where(and(eq(invitations.email, email), isNull(invitations.acceptedAt)))
      .get();
    if (pending) {
      return c.json({ error: { message: 'Pozvánka pro tento e-mail už čeká na přijetí' } }, 409);
    }

    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    db.insert(invitations)
      .values({
        id,
        email,
        role: input.role,
        token,
        invitedByUserId: me.id,
        expiresAt,
      })
      .run();

    const acceptUrl = `${env.PUBLIC_APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;
    await emailSender.send({
      to: email,
      subject: `Pozvánka do Inventory Hub`,
      text: [
        `Ahoj!`,
        ``,
        `${me.name} (${me.email}) tě zve do Inventory Hub jako role ${input.role}.`,
        ``,
        `Pro přijetí klikni na následující odkaz (platí 7 dní):`,
        acceptUrl,
        ``,
        `Pokud jsi tuto pozvánku nečekal/a, můžeš e-mail ignorovat.`,
      ].join('\n'),
    });

    return c.json({ id, email, role: input.role, acceptUrl }, 201);
  })
  .delete('/:id', requireAuth('admin'), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const result = db.delete(invitations).where(eq(invitations.id, id)).run();
    if (result.changes === 0) return c.json({ error: { message: 'Pozvánka nenalezena' } }, 404);
    return c.json({ ok: true });
  });
