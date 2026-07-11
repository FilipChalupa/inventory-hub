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
  startedAt: z.coerce.date().nullable(),
  expectedReturnAt: z.coerce.date().nullable(),
  createdByUserId: z.string().uuid(),
  createdAt: z.coerce.date(),
  items: z.array(loanItemSchema),
});
export type Loan = z.infer<typeof loanSchema>;

export const createLoanInput = z
  .object({
    borrowerName: z.string().trim().min(1).max(200),
    borrowerUserId: z.string().uuid().nullable().optional(),
    borrowerContactId: z.string().uuid().nullable().optional(),
    borrowerContact: z.string().trim().max(200).nullable().optional(),
    purpose: z.string().trim().max(500).nullable().optional(),
    // When set to a future moment the loan is created as "planned": the
    // assets are reserved (one active/planned loan per asset) but stay in
    // stock until the loan is started. Omitted/past => starts immediately.
    loanedAt: z.coerce.date().nullable().optional(),
    expectedReturnAt: z.coerce.date().nullable().optional(),
    assetCodes: z.array(assetCodeSchema).min(1, 'Výpůjčka musí obsahovat alespoň jeden asset'),
  })
  .refine((v) => !(v.loanedAt && v.expectedReturnAt) || v.expectedReturnAt >= v.loanedAt, {
    message: 'Návrat nemůže být dříve než začátek výpůjčky',
    path: ['expectedReturnAt'],
  });
export type CreateLoanInput = z.infer<typeof createLoanInput>;

/**
 * Whether two loan windows overlap. Windows are half-open `[start, end)`,
 * so back-to-back loans (one ends exactly when the next starts) do NOT
 * conflict. A null end means open-ended (+∞) — used when no expected
 * return date is set.
 */
export function loanWindowsOverlap(
  aStart: Date,
  aEnd: Date | null,
  bStart: Date,
  bEnd: Date | null,
): boolean {
  const aStartsBeforeBEnds = bEnd === null || aStart.getTime() < bEnd.getTime();
  const bStartsBeforeAEnds = aEnd === null || bStart.getTime() < aEnd.getTime();
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

export const updateLoanInput = z
  .object({
    borrowerName: z.string().trim().min(1).max(200).optional(),
    borrowerContactId: z.string().uuid().nullable().optional(),
    borrowerContact: z.string().trim().max(200).nullable().optional(),
    purpose: z.string().trim().max(500).nullable().optional(),
    // Only changeable while the loan is still planned.
    loanedAt: z.coerce.date().optional(),
    expectedReturnAt: z.coerce.date().nullable().optional(),
  })
  .refine((v) => !(v.loanedAt && v.expectedReturnAt) || v.expectedReturnAt >= v.loanedAt, {
    message: 'Návrat nemůže být dříve než začátek výpůjčky',
    path: ['expectedReturnAt'],
  });
export type UpdateLoanInput = z.infer<typeof updateLoanInput>;

/**
 * Self-service reservation request (issue #2). A `member` picks assets and a
 * window; an operator/admin later approves it into a planned loan or rejects
 * it. The borrower is always the requesting user, so no borrower fields here.
 */
export const requestLoanInput = z
  .object({
    assetCodes: z.array(assetCodeSchema).min(1, 'Žádost musí obsahovat alespoň jeden asset'),
    // Requested start; omitted/past means "as soon as approved".
    loanedAt: z.coerce.date().nullable().optional(),
    expectedReturnAt: z.coerce.date().nullable().optional(),
    purpose: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => !(v.loanedAt && v.expectedReturnAt) || v.expectedReturnAt >= v.loanedAt, {
    message: 'Návrat nemůže být dříve než začátek výpůjčky',
    path: ['expectedReturnAt'],
  });
export type RequestLoanInput = z.infer<typeof requestLoanInput>;

export const addLoanItemsInput = z.object({
  assetCodes: z.array(assetCodeSchema).min(1, 'Vyber alespoň jeden asset'),
});
export type AddLoanItemsInput = z.infer<typeof addLoanItemsInput>;

export const returnLoanItemInput = z.object({
  loanItemId: z.string().uuid(),
  returnCondition: z.enum(loanItemConditions),
  returnNotes: z.string().trim().max(1000).nullable().optional(),
  // When omitted the return is recorded as "now". A past date lets you
  // backdate a return that physically happened earlier.
  returnedAt: z.coerce.date().optional(),
});
export type ReturnLoanItemInput = z.infer<typeof returnLoanItemInput>;

export type LoanStatus = 'requested' | 'planned' | 'open' | 'partially_returned' | 'fully_returned';

export function deriveLoanStatus(loan: {
  startedAt: Date | null;
  items: Pick<LoanItem, 'returnedAt'>[];
  // Optional self-service fields. When a loan was requested by a member and
  // has not been approved yet it is a pending request rather than a plain
  // reservation. Callers that omit these keep the pre-request behaviour.
  requestedByUserId?: string | null;
  approvedAt?: Date | null;
}): LoanStatus {
  // A not-yet-started loan is either a pending self-service request (requested
  // by a member, still awaiting approval) or an ordinary reservation.
  if (loan.startedAt === null) {
    if (loan.requestedByUserId != null && loan.approvedAt == null) return 'requested';
    return 'planned';
  }
  const total = loan.items.length;
  if (total === 0) return 'open';
  const returned = loan.items.filter((i) => i.returnedAt !== null).length;
  if (returned === 0) return 'open';
  if (returned === total) return 'fully_returned';
  return 'partially_returned';
}

export function isOverdue(
  loan: Pick<Loan, 'startedAt' | 'expectedReturnAt' | 'items'>,
  now: Date = new Date(),
): boolean {
  // Planned (not yet started) loans can never be overdue.
  if (loan.startedAt === null) return false;
  if (!loan.expectedReturnAt) return false;
  if (deriveLoanStatus(loan) === 'fully_returned') return false;
  return now > loan.expectedReturnAt;
}
