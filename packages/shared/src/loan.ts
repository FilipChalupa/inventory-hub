import { z } from 'zod';
import { assetCodeSchema } from './asset.js';

export const loanItemConditions = ['ok', 'damaged'] as const;
export type LoanItemCondition = (typeof loanItemConditions)[number];

export const loanItemSchema = z.object({
  id: z.string().uuid(),
  loanId: z.string().uuid(),
  assetId: z.string().uuid(),
  returnedAt: z.coerce.date().nullable(),
  returnCondition: z.enum(loanItemConditions).nullable(),
  returnNotes: z.string().nullable(),
});
export type LoanItem = z.infer<typeof loanItemSchema>;

export const loanSchema = z.object({
  id: z.string().uuid(),
  borrowerName: z.string().min(1).max(200),
  borrowerUserId: z.string().uuid().nullable(),
  borrowerContact: z.string().max(200).nullable(),
  purpose: z.string().max(500).nullable(),
  loanedAt: z.coerce.date(),
  expectedReturnAt: z.coerce.date().nullable(),
  createdByUserId: z.string().uuid(),
  createdAt: z.coerce.date(),
  items: z.array(loanItemSchema),
});
export type Loan = z.infer<typeof loanSchema>;

export const createLoanInput = z.object({
  borrowerName: z.string().min(1).max(200),
  borrowerUserId: z.string().uuid().nullable().optional(),
  borrowerContact: z.string().max(200).nullable().optional(),
  purpose: z.string().max(500).nullable().optional(),
  expectedReturnAt: z.coerce.date().nullable().optional(),
  assetCodes: z.array(assetCodeSchema).min(1, 'Výpůjčka musí obsahovat alespoň jeden asset'),
});
export type CreateLoanInput = z.infer<typeof createLoanInput>;

export const returnLoanItemInput = z.object({
  loanItemId: z.string().uuid(),
  returnCondition: z.enum(loanItemConditions),
  returnNotes: z.string().max(1000).nullable().optional(),
});
export type ReturnLoanItemInput = z.infer<typeof returnLoanItemInput>;

export type LoanStatus = 'open' | 'partially_returned' | 'fully_returned';

export function deriveLoanStatus(items: Pick<LoanItem, 'returnedAt'>[]): LoanStatus {
  const total = items.length;
  if (total === 0) return 'open';
  const returned = items.filter((i) => i.returnedAt !== null).length;
  if (returned === 0) return 'open';
  if (returned === total) return 'fully_returned';
  return 'partially_returned';
}

export function isOverdue(loan: Pick<Loan, 'expectedReturnAt' | 'items'>, now: Date = new Date()): boolean {
  if (!loan.expectedReturnAt) return false;
  if (deriveLoanStatus(loan.items) === 'fully_returned') return false;
  return now > loan.expectedReturnAt;
}
