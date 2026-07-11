import { Hono } from 'hono';
import { and, eq, isNotNull, isNull, lt, lte } from 'drizzle-orm';
import { nextServiceDue } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { assets, damageReports, loanItems, loans, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

/** How far ahead warranty / service dates are surfaced as notifications. */
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;
/** Cap on the number of feed items returned. */
const FEED_LIMIT = 50;

export type NotificationSeverity = 'info' | 'warning' | 'danger';

export type NotificationItem = {
  id: string;
  type: 'overdue_loan' | 'warranty' | 'service' | 'damage';
  severity: NotificationSeverity;
  title: string;
  message: string;
  link: string;
  /** ISO timestamp used for ordering and unread computation. */
  at: string;
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The "surfaced at" timestamp for unread/ordering: the later of when the
 * condition became due and when its record was created. This keeps a
 * back-dated or freshly-imported record (e.g. an asset added today with an
 * already-lapsed warranty) counted as unread even though its due date is past.
 */
function laterIso(a: Date, b: Date): string {
  return (a.getTime() >= b.getTime() ? a : b).toISOString();
}

/**
 * Builds the current user's derived, read-only notification feed. Items are
 * computed on the fly from overdue loans, expiring warranties, due services
 * and open damage reports — nothing is persisted. Role scoping: members see
 * only their own (assets assigned to them, loans they borrowed); admin,
 * operator and auditor see the whole organization.
 */
export const notificationRoutes = new Hono<AppContext>()
  .get('/', requireAuth(), (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    const now = new Date();
    const soon = new Date(now.getTime() + WINDOW_MS);
    // Members are scoped to their own records; every other role is org-wide.
    const scoped = user.role === 'member';

    const items: NotificationItem[] = [];

    // --- Overdue loans (expected return in the past, still has open items) ---
    const overdueCandidates = db
      .select()
      .from(loans)
      .where(
        and(
          // Only started loans can be overdue (excludes planned loans and
          // unapproved reservation requests).
          isNotNull(loans.startedAt),
          isNotNull(loans.expectedReturnAt),
          lt(loans.expectedReturnAt, now),
          scoped ? eq(loans.borrowerUserId, user.id) : undefined,
        ),
      )
      .all();
    for (const loan of overdueCandidates) {
      const loanItemRows = db
        .select({ returnedAt: loanItems.returnedAt })
        .from(loanItems)
        .where(eq(loanItems.loanId, loan.id))
        .all();
      if (loanItemRows.length === 0) continue;
      if (loanItemRows.every((i) => i.returnedAt !== null)) continue;
      items.push({
        id: `overdue-loan-${loan.id}`,
        type: 'overdue_loan',
        severity: 'danger',
        title: 'Výpůjčka po termínu',
        message: `${loan.borrowerName} — očekáváno vrácení ${formatDate(loan.expectedReturnAt!)}.`,
        link: `/loans/${loan.id}`,
        at: laterIso(loan.expectedReturnAt!, loan.createdAt),
      });
    }

    // --- Assets with an expiring / lapsed warranty ---
    const expiringWarranty = db
      .select({
        code: assets.code,
        name: assets.name,
        warrantyUntil: assets.warrantyUntil,
        createdAt: assets.createdAt,
      })
      .from(assets)
      .where(
        and(
          isNull(assets.archivedAt),
          isNotNull(assets.warrantyUntil),
          lte(assets.warrantyUntil, soon),
          scoped ? eq(assets.assignedToUserId, user.id) : undefined,
        ),
      )
      .all();
    for (const a of expiringWarranty) {
      const lapsed = a.warrantyUntil! < now;
      items.push({
        id: `warranty-${a.code}`,
        type: 'warranty',
        severity: lapsed ? 'danger' : 'warning',
        title: lapsed ? 'Záruka skončila' : 'Záruka brzy končí',
        message: `${a.code} ${a.name}: záruka do ${formatDate(a.warrantyUntil!)}.`,
        link: `/a/${a.code}`,
        at: laterIso(new Date(a.warrantyUntil!.getTime() - WINDOW_MS), a.createdAt),
      });
    }

    // --- Assets with a scheduled service due soon / overdue ---
    const serviceCandidates = db
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
          scoped ? eq(assets.assignedToUserId, user.id) : undefined,
        ),
      )
      .all();
    for (const a of serviceCandidates) {
      const dueAt = nextServiceDue(a);
      if (!dueAt || dueAt > soon) continue;
      const overdue = dueAt < now;
      items.push({
        id: `service-${a.code}`,
        type: 'service',
        severity: overdue ? 'danger' : 'warning',
        title: overdue ? 'Servis po termínu' : 'Blíží se servis',
        message: `${a.code} ${a.name}: servis do ${formatDate(dueAt)}.`,
        link: `/a/${a.code}`,
        at: laterIso(new Date(dueAt.getTime() - WINDOW_MS), a.createdAt),
      });
    }

    // --- Open (unresolved) damage reports ---
    const openDamages = db
      .select({
        id: damageReports.id,
        severity: damageReports.severity,
        reportedAt: damageReports.reportedAt,
        code: assets.code,
        name: assets.name,
      })
      .from(damageReports)
      .innerJoin(assets, eq(damageReports.assetId, assets.id))
      .where(
        and(
          isNull(damageReports.resolvedAt),
          scoped ? eq(assets.assignedToUserId, user.id) : undefined,
        ),
      )
      .all();
    for (const d of openDamages) {
      items.push({
        id: `damage-${d.id}`,
        type: 'damage',
        severity: d.severity === 'total' ? 'danger' : 'warning',
        title: 'Otevřené hlášení poškození',
        message: `${d.code} ${d.name}: nevyřešené poškození.`,
        link: `/a/${d.code}`,
        at: d.reportedAt.toISOString(),
      });
    }

    // Newest first, then cap the feed length.
    items.sort((a, b) => b.at.localeCompare(a.at));
    const limited = items.slice(0, FEED_LIMIT);

    const seenAt = user.lastNotificationsSeenAt;
    const unreadCount = seenAt
      ? limited.filter((i) => new Date(i.at) > seenAt).length
      : limited.length;

    return c.json({ items: limited, unreadCount });
  })
  // Mark the feed as seen — anything older than this no longer counts as unread.
  .post('/seen', requireAuth(), (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    db.update(users)
      .set({ lastNotificationsSeenAt: new Date() })
      .where(eq(users.id, user.id))
      .run();
    return c.json({ ok: true });
  });
