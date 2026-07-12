import { and, eq, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assets, users } from '../db/schema.js';
import type { EmailSender } from './email.js';
import { emailCopy, type EmailLocale } from './email-copy.js';

export type WarrantyRunResult = { found: number; notifiedAdmins: number };

/** How far ahead a warranty is flagged as "expiring soon". */
export const WARRANTY_WINDOW_DAYS = 30;

/**
 * Sends admins a digest of non-archived assets whose warranty expires within
 * the next {@link WARRANTY_WINDOW_DAYS} days (or has already lapsed without a
 * prior notice). Idempotent per asset via `warranty_reminder_sent_at`, which
 * the asset-update route clears whenever the warranty date changes.
 */
export async function runWarrantyReminders(
  db: Db,
  emailSender: EmailSender,
  options: { now?: Date; publicAppUrl: string; locale?: EmailLocale } = { publicAppUrl: '' },
): Promise<WarrantyRunResult> {
  const now = options.now ?? new Date();
  const soon = new Date(now.getTime() + WARRANTY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const expiring = db
    .select({
      code: assets.code,
      name: assets.name,
      warrantyUntil: assets.warrantyUntil,
    })
    .from(assets)
    .where(
      and(
        isNull(assets.archivedAt),
        isNotNull(assets.warrantyUntil),
        lte(assets.warrantyUntil, soon),
        isNull(assets.warrantyReminderSentAt),
      ),
    )
    .all();

  if (expiring.length === 0) return { found: 0, notifiedAdmins: 0 };

  const admins = db
    .select()
    .from(users)
    .where(or(eq(users.role, 'admin')))
    .all()
    .filter((a) => !a.disabledAt);

  let notifiedAdmins = 0;
  if (admins.length > 0) {
    const copy = emailCopy(options.locale);
    const items = expiring.map((a) => ({
      code: a.code,
      name: a.name,
      until: formatDate(a.warrantyUntil!),
    }));
    for (const admin of admins) {
      try {
        const built = copy.warrantyDigest({
          adminName: admin.name,
          windowDays: WARRANTY_WINDOW_DAYS,
          items,
          assetsUrl: options.publicAppUrl ? `${options.publicAppUrl}/assets` : undefined,
        });
        await emailSender.send({ to: admin.email, subject: built.subject, text: built.text });
        notifiedAdmins += 1;
      } catch (err) {
        console.error(`Warranty admin digest failed for ${admin.email}:`, err);
      }
    }
  }

  // Mark notified so reruns are idempotent (reset on warranty-date change).
  db.update(assets)
    .set({ warrantyReminderSentAt: now })
    .where(
      and(
        isNull(assets.archivedAt),
        isNotNull(assets.warrantyUntil),
        lte(assets.warrantyUntil, soon),
        isNull(assets.warrantyReminderSentAt),
      ),
    )
    .run();

  return { found: expiring.length, notifiedAdmins };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
