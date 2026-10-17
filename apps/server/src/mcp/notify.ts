/**
 * Emails around MCP access: a heads-up whenever an agent gains access to an
 * account (cheap protection against a hijacked session quietly wiring up an
 * agent), and a reminder before a personal token runs out.
 */
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { oauthTokens, users } from '../db/schema.js';
import type { EmailSender } from '../lib/email.js';
import { emailCopy, recipientLocale, type EmailLocale } from '../lib/email-copy.js';

/** How far ahead an expiring personal token triggers a reminder. */
export const TOKEN_EXPIRY_WINDOW_DAYS = 7;

function manageUrl(publicAppUrl: string): string | undefined {
  return publicAppUrl ? `${publicAppUrl.replace(/\/$/, '')}/agents` : undefined;
}

export async function notifyAgentConnected(
  db: Db,
  emailSender: EmailSender,
  input: {
    userId: string;
    agentName: string;
    kind: 'oauth' | 'personal';
    readWrite: boolean;
    publicAppUrl: string;
    locale?: EmailLocale;
  },
): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, input.userId)).get();
  if (!user || user.disabledAt) return;
  const built = emailCopy(recipientLocale(user, input.locale)).agentConnected({
    name: user.name,
    agentName: input.agentName,
    kind: input.kind,
    readWrite: input.readWrite,
    manageUrl: manageUrl(input.publicAppUrl),
  });
  try {
    await emailSender.send({ to: user.email, subject: built.subject, text: built.text });
  } catch (err) {
    console.error(`Agent-connected email failed for ${user.email}:`, err);
  }
}

/** Security notice: a replayed refresh token got the connection revoked. */
export async function notifyAgentRevokedForReuse(
  db: Db,
  emailSender: EmailSender,
  input: { userId: string; agentName: string; publicAppUrl: string; locale?: EmailLocale },
): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, input.userId)).get();
  if (!user || user.disabledAt) return;
  const built = emailCopy(recipientLocale(user, input.locale)).agentReuseRevoked({
    name: user.name,
    agentName: input.agentName,
    manageUrl: manageUrl(input.publicAppUrl),
  });
  try {
    await emailSender.send({ to: user.email, subject: built.subject, text: built.text });
  } catch (err) {
    console.error(`Agent reuse-revoked email failed for ${user.email}:`, err);
  }
}

/**
 * One email per user listing their personal tokens that expire within
 * {@link TOKEN_EXPIRY_WINDOW_DAYS}. Idempotent via `expiry_notified_at`.
 */
export async function runMcpTokenExpiryReminders(
  db: Db,
  emailSender: EmailSender,
  options: { now?: Date; publicAppUrl: string; locale?: EmailLocale },
): Promise<{ notifiedUsers: number }> {
  const now = options.now ?? new Date();
  const soon = new Date(now.getTime() + TOKEN_EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const due = db
    .select()
    .from(oauthTokens)
    .where(
      and(
        eq(oauthTokens.kind, 'personal'),
        isNull(oauthTokens.expiryNotifiedAt),
        gt(oauthTokens.accessExpiresAt, now),
        lt(oauthTokens.accessExpiresAt, soon),
      ),
    )
    .all();
  if (due.length === 0) return { notifiedUsers: 0 };

  const byUser = new Map<string, typeof due>();
  for (const t of due) byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t]);
  let notifiedUsers = 0;
  for (const [userId, tokens] of byUser) {
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (user && !user.disabledAt) {
      const built = emailCopy(recipientLocale(user, options.locale)).mcpTokensExpiring({
        name: user.name,
        items: tokens.map((t) => ({
          name: t.name ?? '',
          expires: t.accessExpiresAt.toISOString().slice(0, 10),
        })),
        manageUrl: manageUrl(options.publicAppUrl),
      });
      try {
        await emailSender.send({ to: user.email, subject: built.subject, text: built.text });
        notifiedUsers += 1;
      } catch (err) {
        console.error(`MCP token expiry email failed for ${user.email}:`, err);
        continue;
      }
    }
    for (const t of tokens) {
      db.update(oauthTokens).set({ expiryNotifiedAt: now }).where(eq(oauthTokens.id, t.id)).run();
    }
  }
  return { notifiedUsers };
}
