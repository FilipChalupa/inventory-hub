import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import { apiKeys, users, type UserRow } from '../db/schema.js';
import { SESSION_COOKIE, loadSession } from '../lib/sessions.js';
import { hashApiKey } from '../lib/apiKeys.js';

export const authLoader = createMiddleware<AppContext>(async (c, next) => {
  const db = c.get('db');
  const token = getCookie(c, SESSION_COOKIE);
  const session = loadSession(db, token);
  if (session) {
    c.set('user', session.user);
    // Sliding expiry: mirror the extended DB expiry onto the browser cookie so
    // an active session doesn't lapse client-side either.
    if (session.refreshed && token) {
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: c.get('env').NODE_ENV === 'production',
        path: '/',
        expires: session.expiresAt,
      });
    }
    return next();
  }

  // No browser session — fall back to an API key (Authorization: Bearer …)
  // for programmatic / integration access. The key acts as the user that
  // created it. (MCP bearer tokens won't match a key hash, so /mcp keeps
  // using its own authorization.)
  const authz = c.req.header('authorization');
  if (authz?.startsWith('Bearer ')) {
    const presented = authz.slice('Bearer '.length).trim();
    const key = db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.tokenHash, hashApiKey(presented)))
      .get();
    const now = new Date();
    // Only keys scoped for the REST API may authenticate here; a `feeds`-only
    // calendar key is intentionally powerless against `/api/*`.
    if (key && key.scopes.includes('api') && (!key.expiresAt || key.expiresAt > now)) {
      const user = db.select().from(users).where(eq(users.id, key.userId)).get();
      if (user && !user.disabledAt) {
        c.set('user', user);
        // Throttled last-used stamp so we don't write on every request.
        if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > 60_000) {
          db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, key.id)).run();
        }
      }
    }
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
