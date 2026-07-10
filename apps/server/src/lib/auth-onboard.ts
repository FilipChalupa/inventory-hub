import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orgSettings, users, type UserRow } from '../db/schema.js';
import { matchAllowedDomain } from './domain.js';
import type { GoogleUser } from './google-oauth.js';

/**
 * Resolves a Google identity to a local user, creating one when:
 *  - it's the first user in the system → becomes `admin`,
 *  - the email's domain is in the allow-list → uses that domain's default role,
 *  - the email matches an invitation (TODO; not implemented in MVP).
 *
 * Returns `null` when the user is not allowed to sign in (no match).
 */
export function findOrCreateUserForGoogle(db: Db, identity: GoogleUser): UserRow | null {
  // 1) existing user — match by google sub first, then by email
  const bySub = identity.sub
    ? db.select().from(users).where(eq(users.googleSubject, identity.sub)).get()
    : undefined;
  if (bySub) return bySub;

  const byEmail = db.select().from(users).where(eq(users.email, identity.email)).get();
  if (byEmail) {
    if (!byEmail.googleSubject && identity.sub) {
      db.update(users)
        .set({ googleSubject: identity.sub, imageUrl: identity.picture ?? byEmail.imageUrl })
        .where(eq(users.id, byEmail.id))
        .run();
      return {
        ...byEmail,
        googleSubject: identity.sub,
        imageUrl: identity.picture ?? byEmail.imageUrl ?? null,
      };
    }
    return byEmail;
  }

  // 2) bootstrap: first user becomes admin
  const anyUser = db.select({ id: users.id }).from(users).limit(1).get();
  if (!anyUser) {
    return insertUser(db, identity, 'admin');
  }

  // 3) domain auto-join
  const org = db.select().from(orgSettings).where(eq(orgSettings.id, 'singleton')).get();
  const allowed = org?.allowedDomains ?? [];
  const match = matchAllowedDomain(identity.email, allowed);
  if (match) {
    // Verified-email policy: Google accounts are verified by default,
    // and we reject unverified ones explicitly.
    if (!identity.emailVerified) return null;
    return insertUser(db, identity, match.defaultRole);
  }

  // No invitation logic in MVP — reject sign-in.
  return null;
}

function insertUser(db: Db, identity: GoogleUser, role: UserRow['role']): UserRow {
  const id = crypto.randomUUID();
  db.insert(users)
    .values({
      id,
      email: identity.email,
      name: identity.name || identity.email,
      role,
      googleSubject: identity.sub,
      imageUrl: identity.picture ?? null,
    })
    .run();
  const created = db.select().from(users).where(eq(users.id, id)).get();
  if (!created) throw new Error('Failed to insert user');
  return created;
}
