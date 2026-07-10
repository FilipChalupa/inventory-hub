import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users, type UserRow } from '../db/schema.js';

// TODO(compliance): GDPR-related (data export, right-to-erasure, retention
// limits on audit log + session history) is in scope; further compliance
// regimes (HIPAA, SOC 2, ISO 27001…) are out of MVP scope and intentionally
// not addressed yet.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Sliding expiry: once a session is more than halfway through its lifetime,
// an authenticated request pushes the expiry back to a full TTL. So active
// users stay logged in indefinitely while idle sessions still lapse after
// ~30 days. The write happens at most once per half-TTL window per session.
const SESSION_SLIDE_BELOW_MS = SESSION_TTL_MS / 2;

export function createSession(db: Db, userId: string): { token: string; expiresAt: Date } {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.insert(sessions).values({ id: token, userId, expiresAt }).run();
  return { token, expiresAt };
}

export function loadSession(
  db: Db,
  token: string | undefined,
): { user: UserRow; expiresAt: Date; refreshed: boolean } | null {
  if (!token) return null;
  const row = db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, token))
    .get();
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() < now) {
    db.delete(sessions).where(eq(sessions.id, token)).run();
    return null;
  }
  if (row.user.disabledAt) return null;

  let expiresAt = row.expiresAt;
  let refreshed = false;
  if (expiresAt.getTime() - now < SESSION_SLIDE_BELOW_MS) {
    expiresAt = new Date(now + SESSION_TTL_MS);
    db.update(sessions).set({ expiresAt }).where(eq(sessions.id, token)).run();
    refreshed = true;
  }
  return { user: row.user, expiresAt, refreshed };
}

export function deleteSession(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.id, token)).run();
}

export function pruneExpiredSessions(db: Db): void {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}

export const SESSION_COOKIE = 'inv_session';
