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
