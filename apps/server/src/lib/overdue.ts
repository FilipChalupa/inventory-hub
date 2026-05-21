import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { loanItems, loans, users } from '../db/schema.js';
import type { Email, EmailSender } from './email.js';

export type OverdueRunResult = {
  found: number;
  notifiedBorrowers: number;
  notifiedAdmins: number;
};

/**
 * Finds loans past expected_return_at that still have at least one open
 * item and have not been notified yet, then emails the borrower (if a
 * contact is set) and sends an admin digest. Marks each loan as notified
 * so reruns are idempotent.
 */
export async function runOverdueCheck(
  db: Db,
  emailSender: EmailSender,
  options: { now?: Date; publicAppUrl: string } = { publicAppUrl: '' },
): Promise<OverdueRunResult> {
  const now = options.now ?? new Date();

  const candidates = db
    .select()
    .from(loans)
    .where(
      and(
        isNotNull(loans.expectedReturnAt),
        lt(loans.expectedReturnAt, now),
        isNull(loans.overdueNotifiedAt),
      ),
    )
    .all();

  if (candidates.length === 0) {
    return { found: 0, notifiedBorrowers: 0, notifiedAdmins: 0 };
  }

  // Filter out loans that have all items returned.
  const overdue: typeof candidates = [];
  for (const loan of candidates) {
    const items = db
      .select({ returnedAt: loanItems.returnedAt })
      .from(loanItems)
      .where(eq(loanItems.loanId, loan.id))
      .all();
    if (items.length === 0) continue;
    const allReturned = items.every((i) => i.returnedAt !== null);
    if (!allReturned) overdue.push(loan);
  }

  if (overdue.length === 0) return { found: 0, notifiedBorrowers: 0, notifiedAdmins: 0 };

  let notifiedBorrowers = 0;
  for (const loan of overdue) {
    if (!loan.borrowerContact) continue;
    const email: Email = {
      to: loan.borrowerContact,
      subject: `Připomenutí: vrácení vypůjčených předmětů`,
      text: [
        `Ahoj ${loan.borrowerName},`,
        '',
        `výpůjčka s očekávaným vrácením ${formatDate(loan.expectedReturnAt!)} je již po termínu.`,
        loan.purpose ? `Účel: ${loan.purpose}` : '',
        '',
        options.publicAppUrl ? `Detail výpůjčky: ${options.publicAppUrl}/loans/${loan.id}` : '',
        '',
        'Děkujeme za vrácení co nejdříve.',
      ]
        .filter((l) => l !== '')
        .join('\n'),
    };
    try {
      await emailSender.send(email);
      notifiedBorrowers += 1;
    } catch (err) {
      console.error(`Overdue notify failed for loan ${loan.id}:`, err);
    }
  }

  // Single digest to admins.
  const admins = db.select().from(users).where(or(eq(users.role, 'admin'))).all();
  let notifiedAdmins = 0;
  const adminTargets = admins.filter((a) => !a.disabledAt);
  if (adminTargets.length > 0) {
    const lines = overdue.map(
      (l) =>
        `- ${l.borrowerName}: očekáváno ${formatDate(l.expectedReturnAt!)} (id ${l.id.slice(0, 8)})`,
    );
    for (const admin of adminTargets) {
      try {
        await emailSender.send({
          to: admin.email,
          subject: `Inventory Hub: ${overdue.length} výpůjček po termínu`,
          text: [
            `Ahoj ${admin.name},`,
            '',
            `Aktuálně je ${overdue.length} výpůjček po termínu vrácení:`,
            '',
            ...lines,
            '',
            options.publicAppUrl ? `Přehled výpůjček: ${options.publicAppUrl}/loans` : '',
          ]
            .filter((l) => l !== '')
            .join('\n'),
        });
        notifiedAdmins += 1;
      } catch (err) {
        console.error(`Overdue admin digest failed for ${admin.email}:`, err);
      }
    }
  }

  // Mark notified.
  for (const loan of overdue) {
    db.update(loans)
      .set({ overdueNotifiedAt: now })
      .where(eq(loans.id, loan.id))
      .run();
  }

  return { found: overdue.length, notifiedBorrowers, notifiedAdmins };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}