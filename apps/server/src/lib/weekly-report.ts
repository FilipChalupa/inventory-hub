import { eq, isNull, isNotNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assets, loanItems, loans, users } from '../db/schema.js';
import type { EmailSender } from './email.js';
import { emailCopy, type EmailLocale } from './email-copy.js';

export type WeeklyReportResult = { notifiedAdmins: number };

/**
 * Emails admins a weekly inventory digest: active asset count, open/overdue
 * loans and total purchase value. Best-effort — logs and continues on send
 * failures. Scheduling/idempotency is the caller's concern (see index.ts).
 */
export async function runWeeklyReport(
  db: Db,
  emailSender: EmailSender,
  options: { now?: Date; publicAppUrl: string; locale?: EmailLocale } = { publicAppUrl: '' },
): Promise<WeeklyReportResult> {
  const now = options.now ?? new Date();

  const admins = db
    .select()
    .from(users)
    .where(or(eq(users.role, 'admin')))
    .all()
    .filter((a) => !a.disabledAt);
  if (admins.length === 0) return { notifiedAdmins: 0 };

  const totalActive =
    db
      .select({ n: sql<number>`count(*)` })
      .from(assets)
      .where(isNull(assets.archivedAt))
      .get()?.n ?? 0;
  const totalValue =
    db
      .select({ v: sql<number>`coalesce(sum(${assets.purchasePrice}), 0)` })
      .from(assets)
      .where(isNull(assets.archivedAt))
      .get()?.v ?? 0;

  // Loans with at least one unreturned item; overdue = past their return date.
  const liveLoans = db
    .select({
      id: loans.id,
      expectedReturnAt: loans.expectedReturnAt,
      openItems: sql<number>`sum(case when ${loanItems.returnedAt} is null then 1 else 0 end)`,
    })
    .from(loans)
    .innerJoin(loanItems, eq(loanItems.loanId, loans.id))
    .where(isNotNull(loans.startedAt))
    .groupBy(loans.id)
    .all()
    .filter((l) => l.openItems > 0);
  const openLoans = liveLoans.length;
  const overdueLoans = liveLoans.filter(
    (l) => l.expectedReturnAt !== null && l.expectedReturnAt < now,
  ).length;

  const money = (minor: number) => (minor / 100).toFixed(2);
  const copy = emailCopy(options.locale);

  let notifiedAdmins = 0;
  for (const admin of admins) {
    try {
      const built = copy.weeklyReport({
        adminName: admin.name,
        totalActive,
        totalValue: money(totalValue),
        openLoans,
        overdueLoans,
        dashboardUrl: options.publicAppUrl ? `${options.publicAppUrl}/dashboard` : undefined,
      });
      await emailSender.send({ to: admin.email, subject: built.subject, text: built.text });
      notifiedAdmins += 1;
    } catch (err) {
      console.error(`Weekly report failed for ${admin.email}:`, err);
    }
  }

  return { notifiedAdmins };
}
