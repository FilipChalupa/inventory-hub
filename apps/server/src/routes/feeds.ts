import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { deriveLoanStatus } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { apiKeys, loanItems, loans, users } from '../db/schema.js';
import { hashApiKey } from '../lib/apiKeys.js';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local all-day date `YYYYMMDD` so the event lands on the right calendar day. */
const icsDate = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/** UTC timestamp `YYYYMMDDTHHMMSSZ` for DTSTAMP. */
const icsStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

const esc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

const addDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

/**
 * Public, subscribable calendar feeds. Mounted OUTSIDE `/api/*` (which requires
 * a session) because calendar clients fetch server-to-server with no cookie —
 * the feed authenticates itself with an API key passed as `?token=`.
 */
export const feedRoutes = new Hono<AppContext>().get('/loans.ics', (c) => {
  const db = c.get('db');
  const env = c.get('env');
  const now = new Date();

  const token = c.req.query('token');
  if (!token) return c.json({ error: { message: 'Chybí token' } }, 401);
  const key = db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.tokenHash, hashApiKey(token)))
    .get();
  if (!key || (key.expiresAt && key.expiresAt <= now)) {
    return c.json({ error: { message: 'Neplatný token' } }, 401);
  }
  // The key must be scoped for calendar feeds. A REST-only (`api`) key can't
  // read the feed, and a `feeds` key can't do anything else.
  if (!key.scopes.includes('feeds')) {
    return c.json({ error: { message: 'Klíč nemá oprávnění ke kalendáři' } }, 403);
  }
  const user = db.select().from(users).where(eq(users.id, key.userId)).get();
  if (!user || user.disabledAt) return c.json({ error: { message: 'Neplatný token' } }, 401);

  // Throttled last-used stamp so a calendar client polling every few minutes
  // doesn't write on every fetch — mirrors the Bearer path in auth.ts.
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > 60_000) {
    db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, key.id)).run();
  }

  const allLoans = db.select().from(loans).all();
  const allItems = db.select().from(loanItems).all();
  const itemsByLoan = new Map<string, typeof allItems>();
  for (const it of allItems) {
    const list = itemsByLoan.get(it.loanId) ?? [];
    list.push(it);
    itemsByLoan.set(it.loanId, list);
  }

  const base = env.PUBLIC_APP_URL.replace(/\/$/, '');
  const host = base.replace(/^https?:\/\//, '') || 'inventory-hub';
  const stamp = icsStamp(now);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Inventory Hub//Loans//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Inventory Hub – výpůjčky',
  ];

  const event = (uid: string, day: Date, summary: string, url: string) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(day)}`,
      `DTEND;VALUE=DATE:${icsDate(addDay(day))}`,
      `SUMMARY:${esc(summary)}`,
      `URL:${esc(url)}`,
      `DESCRIPTION:${esc(url)}`,
      'END:VEVENT',
    );
  };

  for (const loan of allLoans) {
    const its = itemsByLoan.get(loan.id) ?? [];
    const status = deriveLoanStatus({
      startedAt: loan.startedAt,
      items: its,
      requestedByUserId: loan.requestedByUserId,
      approvedAt: loan.approvedAt,
    });
    // Skip history (returned) and pending self-service requests (not yet
    // confirmed) — the feed only carries real reservations and loans.
    if (status === 'fully_returned' || status === 'requested') continue;
    const url = `${base}/loans/${loan.id}`;
    const count = its.length;
    if (status === 'planned') {
      event(
        `loan-${loan.id}-start`,
        loan.loanedAt,
        `Začátek výpůjčky: ${loan.borrowerName} (${count} ks)`,
        url,
      );
    }
    if (loan.expectedReturnAt) {
      event(
        `loan-${loan.id}-return`,
        loan.expectedReturnAt,
        `Vrátit: ${loan.borrowerName} (${count} ks)`,
        url,
      );
    }
  }

  lines.push('END:VCALENDAR');
  return c.body(lines.join('\r\n') + '\r\n', 200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': 'inline; filename="inventory-hub-loans.ics"',
    'cache-control': 'no-store',
  });
});
