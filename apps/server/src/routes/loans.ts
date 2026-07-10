import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, gte, inArray, isNull, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  createLoanInput,
  updateLoanInput,
  addLoanItemsInput,
  returnLoanItemInput,
  deriveLoanStatus,
  loanWindowsOverlap,
} from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import {
  assetEvents,
  assets,
  damageReports,
  loanItems,
  loans,
  users,
  type LoanRow,
  type UserRow,
} from '../db/schema.js';
import { findLoanWindowConflicts } from '../lib/loan.js';
import { activateLoan } from '../lib/loanActivation.js';
import { runOverdueCheck } from '../lib/overdue.js';
import { requireAuth } from '../middleware/auth.js';

// An asset can be put on a loan only from these states. `on_loan` is
// allowed because a future window may start after the asset is returned;
// the time-overlap check decides whether it actually fits.
const LOANABLE_STATUSES = ['in_stock', 'on_loan'] as const;

// Why an asset cannot be loaned based purely on its current state (the
// time-window conflict is handled separately).
const STATUS_UNAVAILABLE_REASON: Record<string, string> = {
  assigned: 'přiřazeno',
  in_repair: 'v opravě',
  damaged: 'poškozeno',
  sold: 'prodáno',
  lost: 'ztraceno',
  retired: 'vyřazeno',
};

// Shared guard for a (possibly backdated) return date: it cannot be in the
// future, nor before the day the loan started. The return date is a calendar
// day (the UI sends a date-only value, i.e. midnight UTC), so a loan may be
// returned on the same day it started — compare against the start of the
// loan's day rather than its exact timestamp, otherwise a same-day return is
// wrongly rejected as "before the loan started".
// Self-service authorization for returning a loan: admins/operators may return
// any loan; everyone else (a `member`) only a loan borrowed by them. Auditors
// never reach this — the global read-only guard rejects their mutations first.
function canReturnLoan(user: UserRow, loan: LoanRow): boolean {
  if (user.role === 'admin' || user.role === 'operator') return true;
  return loan.borrowerUserId === user.id;
}

function returnDateError(returnedAt: Date, loanStart: Date, now: Date): string | null {
  if (returnedAt.getTime() > now.getTime()) return 'Datum vrácení nemůže být v budoucnu';
  const startOfLoanDay = Date.UTC(
    loanStart.getUTCFullYear(),
    loanStart.getUTCMonth(),
    loanStart.getUTCDate(),
  );
  if (returnedAt.getTime() < startOfLoanDay) return 'Datum vrácení nemůže být před zapůjčením';
  return null;
}

export const loanRoutes = new Hono<AppContext>()
  .get('/', (c) => {
    const db = c.get('db');
    const q = c.req.query('q')?.trim();
    const limit = Math.min(Number(c.req.query('limit') ?? '100') || 100, 200);
    const offset = Math.max(Number(c.req.query('offset') ?? '0') || 0, 0);

    const where = q
      ? sql`lower(${loans.borrowerName}) like ${'%' + q.toLowerCase() + '%'}`
      : undefined;

    const total = db
      .select({ n: sql<number>`count(*)` })
      .from(loans)
      .where(where)
      .get()!.n;

    const rows = db
      .select()
      .from(loans)
      .where(where)
      .orderBy(desc(loans.loanedAt))
      .limit(limit)
      .offset(offset)
      .all();

    const items = rows.length
      ? db
          .select()
          .from(loanItems)
          .where(
            inArray(
              loanItems.loanId,
              rows.map((l) => l.id),
            ),
          )
          .all()
      : [];

    const itemsByLoan = new Map<string, typeof items>();
    for (const it of items) {
      const list = itemsByLoan.get(it.loanId) ?? [];
      list.push(it);
      itemsByLoan.set(it.loanId, list);
    }

    const result = rows.map((loan) => {
      const loanItemsForLoan = itemsByLoan.get(loan.id) ?? [];
      return {
        ...loan,
        items: loanItemsForLoan,
        status: deriveLoanStatus({ startedAt: loan.startedAt, items: loanItemsForLoan }),
      };
    });

    return c.json({ items: result, total });
  })
  // All live (non-archived) assets annotated with whether they can be
  // committed to a loan in the given window. Unavailable assets are still
  // returned (with a reason) so the UI can show them disabled rather than
  // hiding their existence. A currently borrowed asset is available when it
  // is free again within [from, to).
  .get('/availability', (c) => {
    const db = c.get('db');
    const q = c.req.query('q')?.trim().toLowerCase();
    const fromRaw = c.req.query('from');
    const toRaw = c.req.query('to');
    const from = fromRaw ? new Date(fromRaw) : new Date();
    const to = toRaw ? new Date(toRaw) : null;

    let candidates = db
      .select({ id: assets.id, code: assets.code, name: assets.name, status: assets.status })
      .from(assets)
      .where(isNull(assets.archivedAt))
      .orderBy(asc(assets.code))
      .all();

    if (q) {
      candidates = candidates.filter(
        (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
      );
    }

    const ids = candidates.map((a) => a.id);
    const committed = ids.length
      ? db
          .select({
            assetId: loanItems.assetId,
            loanedAt: loans.loanedAt,
            expectedReturnAt: loans.expectedReturnAt,
          })
          .from(loanItems)
          .innerJoin(loans, eq(loanItems.loanId, loans.id))
          .where(and(inArray(loanItems.assetId, ids), isNull(loanItems.returnedAt)))
          .all()
      : [];

    const windowsByAsset = new Map<string, { loanedAt: Date; expectedReturnAt: Date | null }[]>();
    for (const w of committed) {
      const list = windowsByAsset.get(w.assetId) ?? [];
      list.push({ loanedAt: w.loanedAt, expectedReturnAt: w.expectedReturnAt });
      windowsByAsset.set(w.assetId, list);
    }

    const loanable = new Set<string>(LOANABLE_STATUSES);
    const items = candidates.map((a) => {
      if (!loanable.has(a.status)) {
        return {
          ...a,
          available: false,
          reason: STATUS_UNAVAILABLE_REASON[a.status] ?? a.status,
        };
      }
      const windows = windowsByAsset.get(a.id) ?? [];
      const busy = windows.some((w) =>
        loanWindowsOverlap(from, to, w.loanedAt, w.expectedReturnAt),
      );
      return {
        ...a,
        available: !busy,
        reason: busy ? 'obsazeno ve zvoleném termínu' : undefined,
      };
    });

    return c.json({ items });
  })
  // Open commitments (active + planned) for one asset, ordered by start —
  // the availability timeline shown on the asset detail page.
  .get('/for-asset/:code', (c) => {
    const db = c.get('db');
    const code = c.req.param('code').toUpperCase();
    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);

    const rows = db
      .select({
        id: loans.id,
        borrowerName: loans.borrowerName,
        loanedAt: loans.loanedAt,
        startedAt: loans.startedAt,
        expectedReturnAt: loans.expectedReturnAt,
      })
      .from(loanItems)
      .innerJoin(loans, eq(loanItems.loanId, loans.id))
      .where(and(eq(loanItems.assetId, asset.id), isNull(loanItems.returnedAt)))
      .orderBy(asc(loans.loanedAt))
      .all();

    const items = rows.map((r) => ({
      ...r,
      status: r.startedAt === null ? ('planned' as const) : ('active' as const),
    }));
    return c.json({ items });
  })
  // All live (non-archived) assets with their open commitments (active +
  // planned), for the multi-asset availability calendar. Each window's start
  // is the loan's effective start (loanedAt while planned, startedAt once
  // active); a null end is open-ended.
  .get('/calendar', (c) => {
    const db = c.get('db');
    const q = c.req.query('q')?.trim().toLowerCase();
    // Optional "free in the whole window" filter: keep only loanable assets
    // with no open commitment overlapping [freeFrom, freeTo).
    const freeFromRaw = c.req.query('freeFrom');
    const freeToRaw = c.req.query('freeTo');
    const freeFrom = freeFromRaw ? new Date(freeFromRaw) : null;
    const freeTo = freeToRaw ? new Date(freeToRaw) : null;
    const limit = Math.min(Number(c.req.query('limit') ?? '100') || 100, 500);
    const offset = Math.max(Number(c.req.query('offset') ?? '0') || 0, 0);

    let candidates = db
      .select({ id: assets.id, code: assets.code, name: assets.name, status: assets.status })
      .from(assets)
      .where(isNull(assets.archivedAt))
      .orderBy(asc(assets.code))
      .all();

    if (q) {
      candidates = candidates.filter(
        (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
      );
    }

    // Open commitments (active + planned) of the matched assets — bounded by
    // the number of live loans, not by loan history.
    const ids = candidates.map((a) => a.id);
    const rows = ids.length
      ? db
          .select({
            assetId: loanItems.assetId,
            loanId: loans.id,
            borrowerName: loans.borrowerName,
            loanedAt: loans.loanedAt,
            startedAt: loans.startedAt,
            expectedReturnAt: loans.expectedReturnAt,
          })
          .from(loanItems)
          .innerJoin(loans, eq(loanItems.loanId, loans.id))
          .where(and(inArray(loanItems.assetId, ids), isNull(loanItems.returnedAt)))
          .orderBy(asc(loans.loanedAt))
          .all()
      : [];

    type CalendarWindow = {
      loanId: string;
      borrowerName: string;
      start: Date;
      end: Date | null;
      status: 'planned' | 'active';
    };
    const windowsByAsset = new Map<string, CalendarWindow[]>();
    for (const r of rows) {
      const list = windowsByAsset.get(r.assetId) ?? [];
      list.push({
        loanId: r.loanId,
        borrowerName: r.borrowerName,
        start: r.startedAt ?? r.loanedAt,
        end: r.expectedReturnAt,
        status: r.startedAt === null ? 'planned' : 'active',
      });
      windowsByAsset.set(r.assetId, list);
    }

    if (freeFrom && freeTo) {
      const loanable = new Set<string>(LOANABLE_STATUSES);
      candidates = candidates.filter(
        (a) =>
          loanable.has(a.status) &&
          !(windowsByAsset.get(a.id) ?? []).some((w) =>
            loanWindowsOverlap(freeFrom, freeTo, w.start, w.end),
          ),
      );
    }

    const total = candidates.length;
    const items = candidates.slice(offset, offset + limit).map((a) => ({
      ...a,
      windows: windowsByAsset.get(a.id) ?? [],
    }));
    return c.json({ items, total });
  })
  // Operational "today" buckets for the dashboard, computed server-side so
  // nothing is silently capped: overdue returns, returns due today, and
  // reservations starting today.
  .get('/today', (c) => {
    const db = c.get('db');
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    // Only loans that could land in a bucket: active ones due on/before today,
    // or planned ones starting today.
    const candidates = db
      .select()
      .from(loans)
      .where(
        or(
          and(
            isNotNull(loans.startedAt),
            isNotNull(loans.expectedReturnAt),
            lt(loans.expectedReturnAt, endOfToday),
          ),
          and(
            isNull(loans.startedAt),
            gte(loans.loanedAt, startOfToday),
            lt(loans.loanedAt, endOfToday),
          ),
        ),
      )
      .all();

    const itemRows = candidates.length
      ? db
          .select()
          .from(loanItems)
          .where(
            inArray(
              loanItems.loanId,
              candidates.map((l) => l.id),
            ),
          )
          .all()
      : [];
    const itemsByLoan = new Map<string, typeof itemRows>();
    for (const it of itemRows) {
      const list = itemsByLoan.get(it.loanId) ?? [];
      list.push(it);
      itemsByLoan.set(it.loanId, list);
    }

    type Bucket = { id: string; borrowerName: string; itemCount: number; date: Date };
    const overdue: Bucket[] = [];
    const dueToday: Bucket[] = [];
    const startingToday: Bucket[] = [];

    for (const loan of candidates) {
      const its = itemsByLoan.get(loan.id) ?? [];
      const status = deriveLoanStatus({ startedAt: loan.startedAt, items: its });
      const base = { id: loan.id, borrowerName: loan.borrowerName, itemCount: its.length };
      if (status === 'planned') {
        startingToday.push({ ...base, date: loan.loanedAt });
      } else if (status !== 'fully_returned' && loan.expectedReturnAt) {
        if (loan.expectedReturnAt.getTime() < startOfToday.getTime()) {
          overdue.push({ ...base, date: loan.expectedReturnAt });
        } else {
          dueToday.push({ ...base, date: loan.expectedReturnAt });
        }
      }
    }

    overdue.sort((a, b) => a.date.getTime() - b.date.getTime());
    return c.json({ overdue, dueToday, startingToday });
  })
  // Loan-centric schedule for the "what's happening" calendar: live loans
  // (planned + open + partially returned) whose window touches [from, to).
  // Fully returned loans are history and are left out.
  .get('/schedule', (c) => {
    const db = c.get('db');
    const fromRaw = c.req.query('from');
    const toRaw = c.req.query('to');
    const from = fromRaw ? new Date(fromRaw) : null;
    const to = toRaw ? new Date(toRaw) : null;

    // SQL pre-filter on the stored window; the effective start used for
    // display is startedAt ?? loanedAt.
    const conds = [];
    if (from) conds.push(or(isNull(loans.expectedReturnAt), gte(loans.expectedReturnAt, from)));
    if (to) conds.push(lte(loans.loanedAt, to));

    const rows = db
      .select()
      .from(loans)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(loans.loanedAt))
      .all();

    const itemRows = rows.length
      ? db
          .select()
          .from(loanItems)
          .where(
            inArray(
              loanItems.loanId,
              rows.map((l) => l.id),
            ),
          )
          .all()
      : [];
    const itemsByLoan = new Map<string, typeof itemRows>();
    for (const it of itemRows) {
      const list = itemsByLoan.get(it.loanId) ?? [];
      list.push(it);
      itemsByLoan.set(it.loanId, list);
    }

    const items = rows
      .map((loan) => {
        const its = itemsByLoan.get(loan.id) ?? [];
        return {
          id: loan.id,
          borrowerName: loan.borrowerName,
          start: loan.startedAt ?? loan.loanedAt,
          end: loan.expectedReturnAt,
          status: deriveLoanStatus({ startedAt: loan.startedAt, items: its }),
          itemCount: its.length,
        };
      })
      .filter((l) => l.status !== 'fully_returned');

    return c.json({ items });
  })
  .get('/:id', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan) return c.json({ error: { message: 'Výpůjčka nenalezena' } }, 404);

    const items = db
      .select({
        id: loanItems.id,
        loanId: loanItems.loanId,
        assetId: loanItems.assetId,
        returnedAt: loanItems.returnedAt,
        returnCondition: loanItems.returnCondition,
        returnNotes: loanItems.returnNotes,
        assetCode: assets.code,
        assetName: assets.name,
      })
      .from(loanItems)
      .innerJoin(assets, eq(loanItems.assetId, assets.id))
      .where(eq(loanItems.loanId, id))
      .orderBy(asc(assets.code))
      .all();

    return c.json({
      loan: {
        ...loan,
        items,
        status: deriveLoanStatus({ startedAt: loan.startedAt, items }),
      },
    });
  })
  // Activity log for one loan, pulled from the per-asset event stream by the
  // loanId stored in each event's payload (newest first).
  .get('/:id/events', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const loan = db.select({ id: loans.id }).from(loans).where(eq(loans.id, id)).get();
    if (!loan) return c.json({ error: { message: 'Výpůjčka nenalezena' } }, 404);

    const rows = db
      .select({
        id: assetEvents.id,
        type: assetEvents.type,
        occurredAt: assetEvents.occurredAt,
        actorUserId: assetEvents.actorUserId,
        actorName: users.name,
        assetCode: assets.code,
        payload: assetEvents.payload,
      })
      .from(assetEvents)
      .leftJoin(assets, eq(assetEvents.assetId, assets.id))
      .leftJoin(users, eq(assetEvents.actorUserId, users.id))
      .where(sql`json_extract(${assetEvents.payload}, '$.loanId') = ${id}`)
      .orderBy(desc(assetEvents.occurredAt))
      .all();

    return c.json({ items: rows });
  })
  .patch('/:id', requireAuth('admin', 'operator'), zValidator('json', updateLoanInput), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan) return c.json({ error: { message: 'Výpůjčka nenalezena' } }, 404);

    const planned = loan.startedAt === null;
    if (input.loanedAt !== undefined && !planned) {
      return c.json({ error: { message: 'U zahájené výpůjčky nelze měnit začátek' } }, 409);
    }

    // Effective window after the patch — used for re-validating overlap.
    const newStart = input.loanedAt ?? loan.loanedAt;
    const newEnd =
      input.expectedReturnAt !== undefined ? input.expectedReturnAt : loan.expectedReturnAt;
    if (newEnd && newEnd.getTime() < newStart.getTime()) {
      return c.json({ error: { message: 'Návrat nemůže být dříve než začátek výpůjčky' } }, 400);
    }

    const windowChanged =
      newStart.getTime() !== loan.loanedAt.getTime() ||
      (newEnd?.getTime() ?? null) !== (loan.expectedReturnAt?.getTime() ?? null);

    if (windowChanged) {
      // Re-check overlap against OTHER loans on this loan's assets.
      const myAssetIds = db
        .select({ assetId: loanItems.assetId })
        .from(loanItems)
        .where(eq(loanItems.loanId, id))
        .all()
        .map((r) => r.assetId);
      if (myAssetIds.length) {
        const conflicts = findLoanWindowConflicts(db, myAssetIds, newStart, newEnd, id);
        if (conflicts.length) {
          return c.json(
            {
              error: {
                message: `Termín koliduje s jinou výpůjčkou u: ${conflicts.join(', ')}`,
              },
            },
            409,
          );
        }
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.borrowerName !== undefined) patch.borrowerName = input.borrowerName;
    if (input.borrowerContactId !== undefined) patch.borrowerContactId = input.borrowerContactId;
    if (input.borrowerContact !== undefined) patch.borrowerContact = input.borrowerContact;
    if (input.purpose !== undefined) patch.purpose = input.purpose;
    if (input.loanedAt !== undefined) patch.loanedAt = input.loanedAt;
    if (input.expectedReturnAt !== undefined) patch.expectedReturnAt = input.expectedReturnAt;

    // Build a diff of what actually changed, for the audit trail.
    // (also drives the notification-flag reset below)
    const fmt = (d: Date | null) => (d ? d.toISOString() : null);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (input.borrowerName !== undefined && input.borrowerName !== loan.borrowerName)
      changes.borrowerName = { from: loan.borrowerName, to: input.borrowerName };
    if (
      input.borrowerContactId !== undefined &&
      (input.borrowerContactId ?? null) !== loan.borrowerContactId
    )
      changes.borrowerContactId = {
        from: loan.borrowerContactId,
        to: input.borrowerContactId ?? null,
      };
    if (
      input.borrowerContact !== undefined &&
      (input.borrowerContact ?? null) !== loan.borrowerContact
    )
      changes.borrowerContact = { from: loan.borrowerContact, to: input.borrowerContact ?? null };
    if (input.purpose !== undefined && (input.purpose ?? null) !== loan.purpose)
      changes.purpose = { from: loan.purpose, to: input.purpose ?? null };
    if (input.loanedAt !== undefined && input.loanedAt.getTime() !== loan.loanedAt.getTime())
      changes.loanedAt = { from: fmt(loan.loanedAt), to: fmt(input.loanedAt) };
    if (
      input.expectedReturnAt !== undefined &&
      (input.expectedReturnAt?.getTime() ?? null) !== (loan.expectedReturnAt?.getTime() ?? null)
    )
      changes.expectedReturnAt = {
        from: fmt(loan.expectedReturnAt),
        to: fmt(input.expectedReturnAt),
      };

    // Changing the deadline re-arms the overdue notifier; changing a planned
    // start re-arms the "starts soon" reminder. Otherwise a stale flag would
    // suppress the next legitimate notification.
    if (changes.expectedReturnAt) patch.overdueNotifiedAt = null;
    if (changes.loanedAt) patch.startReminderSentAt = null;

    const user = c.get('user')!;
    const assetIds = db
      .select({ assetId: loanItems.assetId })
      .from(loanItems)
      .where(eq(loanItems.loanId, id))
      .all()
      .map((r) => r.assetId);

    db.transaction((tx) => {
      tx.update(loans).set(patch).where(eq(loans.id, id)).run();
      if (Object.keys(changes).length) {
        for (const assetId of assetIds) {
          tx.insert(assetEvents)
            .values({
              assetId,
              actorUserId: user.id,
              type: 'loan_updated',
              payload: { loanId: id, changes },
            })
            .run();
        }
      }
    });
    return c.json({ ok: true });
  })
  .delete('/:id', requireAuth('admin'), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan) return c.json({ error: { message: 'Výpůjčka nenalezena' } }, 404);
    if (loan.startedAt !== null) {
      return c.json({ error: { message: 'Zahájenou výpůjčku nelze smazat — vrať položky.' } }, 409);
    }

    const user = c.get('user')!;
    const items = db.select().from(loanItems).where(eq(loanItems.loanId, id)).all();
    db.transaction((tx) => {
      // Log the cancellation on each reserved asset before the items are
      // removed by the cascade delete.
      for (const item of items) {
        tx.insert(assetEvents)
          .values({
            assetId: item.assetId,
            actorUserId: user.id,
            type: 'loan_cancelled',
            payload: { loanId: id, borrower: loan.borrowerName, itemCount: items.length },
          })
          .run();
      }
      tx.delete(loans).where(eq(loans.id, id)).run();
    });

    return c.json({ ok: true });
  })
  .post(
    '/:id/items',
    requireAuth('admin', 'operator'),
    zValidator('json', addLoanItemsInput),
    (c) => {
      const db = c.get('db');
      const id = c.req.param('id');
      const input = c.req.valid('json');
      const loan = db.select().from(loans).where(eq(loans.id, id)).get();
      if (!loan) return c.json({ error: { message: 'Výpůjčka nenalezena' } }, 404);

      const currentItems = db.select().from(loanItems).where(eq(loanItems.loanId, id)).all();
      if (currentItems.length > 0 && currentItems.every((i) => i.returnedAt !== null)) {
        return c.json({ error: { message: 'Výpůjčka je už vrácená' } }, 409);
      }

      const codes = input.assetCodes.map((x) => x.toUpperCase());
      const targets = db.select().from(assets).where(inArray(assets.code, codes)).all();
      if (targets.length !== codes.length) {
        const found = new Set(targets.map((t) => t.code));
        const missing = codes.filter((x) => !found.has(x));
        return c.json({ error: { message: `Asset(y) nenalezen(y): ${missing.join(', ')}` } }, 400);
      }

      const openAssetIds = new Set(
        currentItems.filter((i) => i.returnedAt === null).map((i) => i.assetId),
      );
      const dup = targets.filter((t) => openAssetIds.has(t.id));
      if (dup.length) {
        return c.json(
          {
            error: {
              message: `Asset(y) už ve výpůjčce jsou: ${dup.map((d) => d.code).join(', ')}`,
            },
          },
          409,
        );
      }

      const archived = targets.filter((t) => t.archivedAt !== null);
      if (archived.length) {
        return c.json(
          {
            error: {
              message: `Asset(y) jsou archivované: ${archived.map((b) => b.code).join(', ')}`,
            },
          },
          409,
        );
      }
      const notLoanable = targets.filter(
        (t) => !(LOANABLE_STATUSES as readonly string[]).includes(t.status),
      );
      if (notLoanable.length) {
        return c.json(
          {
            error: {
              message: `Asset(y) nelze v tomto stavu půjčit: ${notLoanable
                .map((b) => `${b.code} (${b.status})`)
                .join(', ')}`,
            },
          },
          409,
        );
      }

      // The added assets must be free in this loan's window vs other loans.
      const newStart = loan.loanedAt;
      const newEnd = loan.expectedReturnAt;
      const targetIds = targets.map((t) => t.id);
      const conflicts = findLoanWindowConflicts(db, targetIds, newStart, newEnd, id);
      if (conflicts.length) {
        return c.json(
          { error: { message: `Asset(y) v daném termínu kolidují: ${conflicts.join(', ')}` } },
          409,
        );
      }

      const user = c.get('user')!;
      const now = new Date();
      const active = loan.startedAt !== null;
      db.transaction((tx) => {
        for (const t of targets) {
          const itemId = crypto.randomUUID();
          tx.insert(loanItems).values({ id: itemId, loanId: id, assetId: t.id }).run();
          if (active) {
            tx.update(assets)
              .set({ status: 'on_loan', updatedAt: now })
              .where(eq(assets.id, t.id))
              .run();
          }
          tx.insert(assetEvents)
            .values({
              assetId: t.id,
              actorUserId: user.id,
              type: 'loan_item_added',
              payload: { loanId: id, borrower: loan.borrowerName },
            })
            .run();
        }
      });

      return c.json({ ok: true, added: targets.length });
    },
  )
  .delete('/:id/items/:itemId', requireAuth('admin', 'operator'), (c) => {
    const db = c.get('db');
    const loanId = c.req.param('id');
    const itemId = c.req.param('itemId');
    const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
    if (!loan) return c.json({ error: { message: 'Výpůjčka nenalezena' } }, 404);

    const item = db
      .select()
      .from(loanItems)
      .where(and(eq(loanItems.id, itemId), eq(loanItems.loanId, loanId)))
      .get();
    if (!item) return c.json({ error: { message: 'Položka výpůjčky nenalezena' } }, 404);
    if (item.returnedAt !== null) {
      return c.json({ error: { message: 'Vrácenou položku nelze odebrat' } }, 409);
    }

    const total = db.select().from(loanItems).where(eq(loanItems.loanId, loanId)).all().length;
    if (total <= 1) {
      return c.json(
        { error: { message: 'Výpůjčka musí mít aspoň jednu položku — zruš celou výpůjčku.' } },
        409,
      );
    }

    const asset = db.select().from(assets).where(eq(assets.id, item.assetId)).get();
    const user = c.get('user')!;
    const now = new Date();
    db.transaction((tx) => {
      tx.delete(loanItems).where(eq(loanItems.id, itemId)).run();
      // On an active loan the asset was out — put it back in stock.
      if (loan.startedAt !== null && asset && asset.status === 'on_loan') {
        tx.update(assets)
          .set({ status: 'in_stock', updatedAt: now })
          .where(eq(assets.id, item.assetId))
          .run();
      }
      tx.insert(assetEvents)
        .values({
          assetId: item.assetId,
          actorUserId: user.id,
          type: 'loan_item_removed',
          payload: { loanId, borrower: loan.borrowerName, assetCode: asset?.code },
        })
        .run();
    });

    return c.json({ ok: true });
  })
  .post('/', requireAuth('admin', 'operator'), zValidator('json', createLoanInput), (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');

    // A future start moment makes this a planned loan: the assets are
    // reserved but stay in stock until the loan is actually started.
    const now = new Date();
    const startAt = input.loanedAt ?? now;
    const planned = startAt.getTime() > now.getTime();

    // Resolve asset codes -> ids.
    const codes = input.assetCodes.map((c) => c.toUpperCase());
    const targets = db.select().from(assets).where(inArray(assets.code, codes)).all();
    if (targets.length !== codes.length) {
      const found = new Set(targets.map((t) => t.code));
      const missing = codes.filter((c) => !found.has(c));
      return c.json({ error: { message: `Asset(y) nenalezen(y): ${missing.join(', ')}` } }, 400);
    }

    const archived = targets.filter((t) => t.archivedAt !== null);
    if (archived.length) {
      return c.json(
        {
          error: {
            message: `Asset(y) jsou archivované: ${archived.map((b) => b.code).join(', ')}`,
          },
        },
        409,
      );
    }

    const notLoanable = targets.filter(
      (t) => !(LOANABLE_STATUSES as readonly string[]).includes(t.status),
    );
    if (notLoanable.length) {
      return c.json(
        {
          error: {
            message: `Asset(y) nelze v tomto stavu půjčit: ${notLoanable
              .map((b) => `${b.code} (${b.status})`)
              .join(', ')}`,
          },
        },
        409,
      );
    }

    const newStart = startAt;
    const newEnd = input.expectedReturnAt ?? null;
    const targetIds = targets.map((t) => t.id);
    const user = c.get('user')!;

    const loanId = crypto.randomUUID();
    // The overlap check and the inserts run in one transaction so two
    // concurrent requests can't both pass the check and double-book.
    let conflictCodes: string[] = [];
    db.transaction((tx) => {
      // An asset may not be committed to two loans whose time windows
      // overlap. Each not-yet-returned loan item reserves its asset for
      // [loanedAt, expectedReturnAt) — open-ended when no return date is
      // set. Non-overlapping (e.g. back-to-back) reservations are allowed.
      conflictCodes = findLoanWindowConflicts(tx, targetIds, newStart, newEnd);
      if (conflictCodes.length) return; // abort: nothing inserted, handled below

      tx.insert(loans)
        .values({
          id: loanId,
          borrowerName: input.borrowerName,
          borrowerUserId: input.borrowerUserId ?? null,
          borrowerContactId: input.borrowerContactId ?? null,
          borrowerContact: input.borrowerContact ?? null,
          purpose: input.purpose ?? null,
          loanedAt: startAt,
          startedAt: planned ? null : now,
          expectedReturnAt: input.expectedReturnAt ?? null,
          createdByUserId: user.id,
        })
        .run();

      for (const t of targets) {
        const itemId = crypto.randomUUID();
        tx.insert(loanItems).values({ id: itemId, loanId, assetId: t.id }).run();
        if (planned) {
          // Reserve only — asset stays in stock until the loan starts.
          tx.insert(assetEvents)
            .values({
              assetId: t.id,
              actorUserId: user.id,
              type: 'loan_planned',
              payload: { loanId, borrower: input.borrowerName, startAt: startAt.toISOString() },
            })
            .run();
        } else {
          tx.update(assets)
            .set({ status: 'on_loan', updatedAt: now })
            .where(eq(assets.id, t.id))
            .run();
          tx.insert(assetEvents)
            .values({
              assetId: t.id,
              actorUserId: user.id,
              type: 'loan_started',
              payload: { loanId, borrower: input.borrowerName },
            })
            .run();
        }
      }
    });

    if (conflictCodes.length) {
      return c.json(
        {
          error: {
            message: `Asset(y) jsou v daném termínu už ve výpůjčce nebo rezervaci: ${conflictCodes.join(
              ', ',
            )}`,
          },
        },
        409,
      );
    }

    return c.json({ id: loanId }, 201);
  })
  .post('/:id/start', requireAuth('admin', 'operator'), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan) return c.json({ error: { message: 'Výpůjčka nenalezena' } }, 404);
    if (loan.startedAt !== null) {
      return c.json({ error: { message: 'Výpůjčka už byla zahájena' } }, 409);
    }
    const user = c.get('user')!;
    activateLoan(db, id, user.id, new Date());
    return c.json({ ok: true });
  })
  // Returning items is a self-service action: admins/operators may return any
  // loan, while a member may return a loan borrowed by them
  // (`borrowerUserId === user.id`). Auditors stay blocked by the global
  // read-only guard, so the ownership check lives in the handler instead of a
  // `requireAuth('admin','operator')` guard.
  .post(
    '/:id/return-all',
    zValidator('json', z.object({ returnedAt: z.coerce.date().optional() })),
    (c) => {
      const db = c.get('db');
      const loanId = c.req.param('id');
      const input = c.req.valid('json');
      const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
      if (!loan) return c.json({ error: { message: 'Výpůjčka nenalezena' } }, 404);
      if (!canReturnLoan(c.get('user')!, loan)) {
        return c.json({ error: { message: 'Nedostatečná oprávnění' } }, 403);
      }
      if (loan.startedAt === null) {
        return c.json({ error: { message: 'Výpůjčka ještě nezačala' } }, 409);
      }

      const open = db
        .select()
        .from(loanItems)
        .where(and(eq(loanItems.loanId, loanId), isNull(loanItems.returnedAt)))
        .all();
      if (open.length === 0) {
        return c.json({ error: { message: 'Žádné nevrácené položky' } }, 409);
      }

      const user = c.get('user')!;
      const now = new Date();
      const returnedAt = input.returnedAt ?? now;
      const dateError = returnDateError(returnedAt, loan.startedAt ?? loan.loanedAt, now);
      if (dateError) return c.json({ error: { message: dateError } }, 400);
      // Bulk return treats everything as returned in good condition; damaged
      // items still go through the per-item flow that files a damage report.
      db.transaction((tx) => {
        for (const item of open) {
          tx.update(loanItems)
            .set({ returnedAt, returnCondition: 'ok', returnNotes: null })
            .where(eq(loanItems.id, item.id))
            .run();
          tx.update(assets)
            .set({ status: 'in_stock', updatedAt: now })
            .where(eq(assets.id, item.assetId))
            .run();
          tx.insert(assetEvents)
            .values({
              assetId: item.assetId,
              actorUserId: user.id,
              type: 'loan_item_returned',
              occurredAt: returnedAt,
              payload: { loanId, itemId: item.id, condition: 'ok' },
            })
            .run();
        }
      });

      return c.json({ ok: true, returned: open.length });
    },
  )
  .post('/notify-overdue', requireAuth('admin'), async (c) => {
    const db = c.get('db');
    const env = c.get('env');
    const emailSender = c.get('emailSender');
    const result = await runOverdueCheck(db, emailSender, { publicAppUrl: env.PUBLIC_APP_URL });
    return c.json(result);
  })
  // Per-item return — same self-service rule as return-all: managers may
  // return any loan, a member only their own (see `canReturnLoan`).
  .post(
    '/:id/items/:itemId/return',
    zValidator('json', returnLoanItemInput.omit({ loanItemId: true })),
    (c) => {
      const db = c.get('db');
      const loanId = c.req.param('id');
      const itemId = c.req.param('itemId');
      const input = c.req.valid('json');

      const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
      if (!loan) return c.json({ error: { message: 'Výpůjčka nenalezena' } }, 404);
      if (!canReturnLoan(c.get('user')!, loan)) {
        return c.json({ error: { message: 'Nedostatečná oprávnění' } }, 403);
      }

      const item = db
        .select()
        .from(loanItems)
        .where(and(eq(loanItems.id, itemId), eq(loanItems.loanId, loanId)))
        .get();
      if (!item) return c.json({ error: { message: 'Položka výpůjčky nenalezena' } }, 404);
      if (item.returnedAt !== null) {
        return c.json({ error: { message: 'Položka už je vrácená' } }, 409);
      }

      const asset = db.select().from(assets).where(eq(assets.id, item.assetId)).get();
      if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);

      const user = c.get('user')!;

      const now = new Date();
      const returnedAt = input.returnedAt ?? now;
      const dateError = returnDateError(returnedAt, loan.startedAt ?? loan.loanedAt, now);
      if (dateError) return c.json({ error: { message: dateError } }, 400);

      db.transaction((tx) => {
        tx.update(loanItems)
          .set({
            returnedAt,
            returnCondition: input.returnCondition,
            returnNotes: input.returnNotes ?? null,
          })
          .where(eq(loanItems.id, itemId))
          .run();

        // Asset status update — when item returns ok and is the last open
        // item, asset goes back in_stock. When damaged, asset goes
        // in_repair and we also create a damage report.
        const targetStatus = input.returnCondition === 'damaged' ? 'in_repair' : 'in_stock';
        tx.update(assets)
          .set({ status: targetStatus, updatedAt: now })
          .where(eq(assets.id, asset.id))
          .run();

        if (input.returnCondition === 'damaged') {
          const damageId = crypto.randomUUID();
          tx.insert(damageReports)
            .values({
              id: damageId,
              assetId: asset.id,
              occurredAt: returnedAt,
              reportedByUserId: user.id,
              description: input.returnNotes ?? 'Poškození zjištěno při vrácení výpůjčky.',
              severity: 'minor',
            })
            .run();
          tx.insert(assetEvents)
            .values({
              assetId: asset.id,
              actorUserId: user.id,
              type: 'damage_reported',
              occurredAt: returnedAt,
              payload: { source: 'loan_return', loanId, damageReportId: damageId },
            })
            .run();
        }

        tx.insert(assetEvents)
          .values({
            assetId: asset.id,
            actorUserId: user.id,
            type: 'loan_item_returned',
            occurredAt: returnedAt,
            payload: { loanId, itemId, condition: input.returnCondition },
          })
          .run();
      });

      return c.json({ ok: true });
    },
  );
