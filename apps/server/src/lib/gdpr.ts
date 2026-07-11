import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  apiKeys,
  assetEvents,
  assets,
  damageReports,
  loanItems,
  loans,
  sessions,
  users,
} from '../db/schema.js';

/**
 * Assembles everything the system holds about a single user (GDPR data-export /
 * right-of-access). Excludes secrets (session tokens, API-key hashes) but
 * includes metadata so the subject sees what exists.
 */
export function exportUserData(db: Db, userId: string): Record<string, unknown> | null {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return null;

  const borrowedLoans = db.select().from(loans).where(eq(loans.borrowerUserId, userId)).all();
  const loansAsBorrower = borrowedLoans.map((loan) => ({
    ...loan,
    items: db.select().from(loanItems).where(eq(loanItems.loanId, loan.id)).all(),
  }));

  const assignedAssets = db
    .select({ code: assets.code, name: assets.name, status: assets.status })
    .from(assets)
    .where(eq(assets.assignedToUserId, userId))
    .all();

  const damageReportsFiled = db
    .select()
    .from(damageReports)
    .where(eq(damageReports.reportedByUserId, userId))
    .all();

  // The user's own actions in the audit trail (capped — this can be large).
  const activity = db
    .select()
    .from(assetEvents)
    .where(eq(assetEvents.actorUserId, userId))
    .orderBy(desc(assetEvents.occurredAt))
    .limit(1000)
    .all();

  const apiKeyMeta = db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      scopes: apiKeys.scopes,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .all();

  const sessionMeta = db
    .select({ expiresAt: sessions.expiresAt, createdAt: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .all();

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      imageUrl: user.imageUrl,
      disabledAt: user.disabledAt,
      createdAt: user.createdAt,
    },
    loansAsBorrower,
    assignedAssets,
    damageReportsFiled,
    activity,
    apiKeys: apiKeyMeta,
    sessions: sessionMeta,
  };
}

/**
 * Right-to-erasure: scrubs a user's personal data in place while keeping the
 * row (so audit/loan history stays referentially intact) and revokes all
 * access. Snapshotted borrower names on their loans are anonymized too. Returns
 * false if the user doesn't exist.
 */
export function anonymizeUser(db: Db, userId: string): boolean {
  const user = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (!user) return false;

  const shortId = userId.slice(0, 8);
  const now = new Date();

  db.transaction((tx) => {
    tx.update(users)
      .set({
        name: 'Anonymizovaný uživatel',
        // Email is NOT NULL + unique — use a stable, non-routable placeholder.
        email: `deleted-${shortId}@anonymized.invalid`,
        googleSubject: null,
        imageUrl: null,
        disabledAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .run();

    // Anonymize the borrower-name snapshot on this user's own loans.
    tx.update(loans)
      .set({ borrowerName: 'Anonymizovaný uživatel', updatedAt: now })
      .where(eq(loans.borrowerUserId, userId))
      .run();

    // Revoke access: drop sessions and API keys.
    tx.delete(sessions).where(eq(sessions.userId, userId)).run();
    tx.delete(apiKeys).where(eq(apiKeys.userId, userId)).run();
  });

  return true;
}
