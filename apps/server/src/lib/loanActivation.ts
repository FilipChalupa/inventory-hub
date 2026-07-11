import { and, eq, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assetEvents, assets, loanItems, loans } from '../db/schema.js';

/**
 * Activates a planned loan: stamps `started_at` and moves every not-yet
 * returned item's asset to `on_loan`, emitting a `loan_started` event per
 * asset. No-op (returns false) when the loan is missing or already started.
 *
 * `actorUserId` is null for automatic (scheduled) activation.
 */
export function activateLoan(
  db: Db,
  loanId: string,
  actorUserId: string | null,
  now: Date = new Date(),
): boolean {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan || loan.startedAt !== null) return false;

  const items = db.select().from(loanItems).where(eq(loanItems.loanId, loanId)).all();

  db.transaction((tx) => {
    tx.update(loans).set({ startedAt: now, updatedAt: now }).where(eq(loans.id, loanId)).run();
    for (const it of items) {
      if (it.returnedAt !== null) continue;
      tx.update(assets)
        .set({ status: 'on_loan', updatedAt: now })
        .where(eq(assets.id, it.assetId))
        .run();
      tx.insert(assetEvents)
        .values({
          assetId: it.assetId,
          actorUserId,
          type: 'loan_started',
          payload: { loanId, borrower: loan.borrowerName },
        })
        .run();
    }
  });

  return true;
}

/**
 * Activates every planned loan whose start moment has arrived. Called on a
 * timer alongside the overdue check so planned loans go live on their own.
 */
export function activateDueLoans(db: Db, now: Date = new Date()): { activated: number } {
  const due = db
    .select({ id: loans.id })
    .from(loans)
    .where(
      and(
        isNull(loans.startedAt),
        lte(loans.loanedAt, now),
        // Never auto-start a pending self-service request: it must be approved
        // first (requestedByUserId set with approvedAt still null).
        or(isNull(loans.requestedByUserId), isNotNull(loans.approvedAt)),
      ),
    )
    .all();

  let activated = 0;
  for (const l of due) {
    if (activateLoan(db, l.id, null, now)) activated += 1;
  }
  return { activated };
}
