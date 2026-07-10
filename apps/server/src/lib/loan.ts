import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { loanWindowsOverlap } from '@inventory-hub/shared';
import type { Db } from '../db/client.js';
import { assets, loanItems, loans } from '../db/schema.js';

export type LoanItemReturnState = { returnedAt: Date | number | null };
export type LoanStatus = 'open' | 'partially_returned' | 'fully_returned';

export function deriveLoanStatus(items: LoanItemReturnState[]): LoanStatus {
  const total = items.length;
  if (total === 0) return 'open';
  const returned = items.filter((i) => i.returnedAt !== null).length;
  if (returned === 0) return 'open';
  if (returned === total) return 'fully_returned';
  return 'partially_returned';
}

// A database handle that can run the conflict query — either the top-level
// `Db` or the transaction handle passed to `db.transaction((tx) => …)`.
type LoanQueryRunner = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Sorted-unique asset codes whose open (not-yet-returned) commitments overlap
 * the window [start, end) among the given target assets. `end === null` means
 * open-ended. Pass `excludeLoanId` to ignore a loan's own items (when
 * re-checking an existing loan). Extracted from the three call sites that
 * enforce the no-double-booking rule (create, edit, add-items) so they share
 * one query and one overlap computation.
 */
export function findLoanWindowConflicts(
  db: LoanQueryRunner,
  targetAssetIds: string[],
  start: Date,
  end: Date | null,
  excludeLoanId?: string,
): string[] {
  const conditions = [inArray(loanItems.assetId, targetAssetIds), isNull(loanItems.returnedAt)];
  if (excludeLoanId !== undefined) conditions.push(ne(loanItems.loanId, excludeLoanId));
  const existing = db
    .select({
      code: assets.code,
      loanedAt: loans.loanedAt,
      expectedReturnAt: loans.expectedReturnAt,
    })
    .from(loanItems)
    .innerJoin(assets, eq(loanItems.assetId, assets.id))
    .innerJoin(loans, eq(loanItems.loanId, loans.id))
    .where(and(...conditions))
    .all();
  return [
    ...new Set(
      existing
        .filter((e) => loanWindowsOverlap(start, end, e.loanedAt, e.expectedReturnAt))
        .map((e) => e.code),
    ),
  ];
}
