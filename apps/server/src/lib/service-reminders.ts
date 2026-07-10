import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { nextServiceDue } from '@inventory-hub/shared';
import type { Db } from '../db/client.js';
import { assets, users } from '../db/schema.js';
import type { EmailSender } from './email.js';

export type ServiceRunResult = { found: number; notifiedAdmins: number };

/** How far ahead a scheduled service is flagged as "due soon". */
export const SERVICE_WINDOW_DAYS = 30;

/**
 * Emails admins a digest of non-archived assets whose next scheduled service
 * falls within the next {@link SERVICE_WINDOW_DAYS} days (or is already
 * overdue). Idempotent per asset via `service_reminder_sent_at`, which the
 * service route and asset-update route clear when the schedule changes.
 */
export async function runServiceReminders(
  db: Db,
  emailSender: EmailSender,
  options: { now?: Date; publicAppUrl: string } = { publicAppUrl: '' },
): Promise<ServiceRunResult> {
  const now = options.now ?? new Date();
  const soon = new Date(now.getTime() + SERVICE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // The next-service date depends on lastServicedAt/purchasedAt/createdAt, so
  // fetch the (bounded) set of scheduled, not-yet-reminded assets and compute
  // the due date in JS rather than in SQL.
  const candidates = db
    .select({
      code: assets.code,
      name: assets.name,
      serviceIntervalDays: assets.serviceIntervalDays,
      lastServicedAt: assets.lastServicedAt,
      purchasedAt: assets.purchasedAt,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(
        isNull(assets.archivedAt),
        isNotNull(assets.serviceIntervalDays),
        isNull(assets.serviceReminderSentAt),
      ),
    )
    .all();

  const due = candidates
    .map((a) => ({ ...a, dueAt: nextServiceDue(a) }))
    .filter((a): a is typeof a & { dueAt: Date } => a.dueAt !== null && a.dueAt <= soon);

  if (due.length === 0) return { found: 0, notifiedAdmins: 0 };

  const admins = db
    .select()
    .from(users)
    .where(or(eq(users.role, 'admin')))
    .all()
    .filter((a) => !a.disabledAt);

  let notifiedAdmins = 0;
  if (admins.length > 0) {
    const lines = due.map((a) => `- ${a.code} ${a.name}: servis do ${formatDate(a.dueAt)}`);
    for (const admin of admins) {
      try {
        await emailSender.send({
          to: admin.email,
          subject: `Inventory Hub: ${due.length} assetů čeká na servis`,
          text: [
            `Ahoj ${admin.name},`,
            '',
            `U ${due.length} assetů je do ${SERVICE_WINDOW_DAYS} dnů naplánovaný servis (nebo už je po termínu):`,
            '',
            ...lines,
            '',
            options.publicAppUrl ? `Přehled assetů: ${options.publicAppUrl}/assets` : '',
          ]
            .filter((l) => l !== '')
            .join('\n'),
        });
        notifiedAdmins += 1;
      } catch (err) {
        console.error(`Service admin digest failed for ${admin.email}:`, err);
      }
    }
  }

  // Mark notified (idempotent; reset when serviced or the interval changes).
  for (const a of due) {
    db.update(assets).set({ serviceReminderSentAt: now }).where(eq(assets.code, a.code)).run();
  }

  return { found: due.length, notifiedAdmins };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
