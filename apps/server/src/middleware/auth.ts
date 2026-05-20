import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { AppContext } from '../app.js';
import type { UserRow } from '../db/schema.js';
import { SESSION_COOKIE, loadSession } from '../lib/sessions.js';

export const authLoader = createMiddleware<AppContext>(async (c, next) => {
  const db = c.get('db');
  const token = getCookie(c, SESSION_COOKIE);
  const session = loadSession(db, token);
  if (session) {
    c.set('user', session.user);
  }
  await next();
});

type Role = UserRow['role'];

export function requireAuth(...allowed: Role[]) {
  return createMiddleware<AppContext>(async (c, next) => {
    const user = c.get('user') as UserRow | undefined;
    if (!user) {
      return c.json({ error: { message: 'Nepřihlášen' } }, 401);
    }
    if (allowed.length > 0 && !allowed.includes(user.role)) {
      return c.json({ error: { message: 'Nedostatečná oprávnění' } }, 403);
    }
    await next();
  });
}
