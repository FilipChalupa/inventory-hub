import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  createLoanInput,
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
} from '../db/schema.js';
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

export const loanRoutes = new Hono<AppContext>()
  .get('/', (c) => {
    const db = c.get('db');
    const rows = db
      .select()
      .from(loans)
      .orderBy(desc(loans.loanedAt))
      .limit(200)
      .all();

    const items = db
      .select()
      .from(loanItems)
      .where(inArray(loanItems.loanId, rows.map((l) => l.id)))
      .all();

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

    return c.json({ items: result });
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
  .post('/', zValidator('json', createLoanInput), (c) => {
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

    // An asset may not be committed to two loans whose time windows
    // overlap. Each not-yet-returned loan item reserves its asset for
    // [loanedAt, expectedReturnAt) — open-ended when no return date is set.
    // Non-overlapping (e.g. back-to-back) reservations are allowed.
    const newStart = startAt;
    const newEnd = input.expectedReturnAt ?? null;
    const targetIds = targets.map((t) => t.id);
    const existing = db
      .select({
        code: assets.code,
        loanedAt: loans.loanedAt,
        expectedReturnAt: loans.expectedReturnAt,
      })
      .from(loanItems)
      .innerJoin(assets, eq(loanItems.assetId, assets.id))
      .innerJoin(loans, eq(loanItems.loanId, loans.id))
      .where(and(inArray(loanItems.assetId, targetIds), isNull(loanItems.returnedAt)))
      .all();
    const conflictCodes = [
      ...new Set(
        existing
          .filter((e) => loanWindowsOverlap(newStart, newEnd, e.loanedAt, e.expectedReturnAt))
          .map((e) => e.code),
      ),
    ];
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

    const user = c.get('user')!;

    const loanId = crypto.randomUUID();
    db.transaction((tx) => {
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

    return c.json({ id: loanId }, 201);
  })
  .post('/:id/start', (c) => {
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
  .post('/notify-overdue', requireAuth('admin'), async (c) => {
    const db = c.get('db');
    const env = c.get('env');
    const emailSender = c.get('emailSender');
    const result = await runOverdueCheck(db, emailSender, { publicAppUrl: env.PUBLIC_APP_URL });
    return c.json(result);
  })
  .post('/:id/items/:itemId/return', zValidator('json', returnLoanItemInput.omit({ loanItemId: true })), (c) => {
    const db = c.get('db');
    const loanId = c.req.param('id');
    const itemId = c.req.param('itemId');
    const input = c.req.valid('json');

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
    db.transaction((tx) => {
      tx.update(loanItems)
        .set({
          returnedAt: now,
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
            occurredAt: now,
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
            payload: { source: 'loan_return', loanId, damageReportId: damageId },
          })
          .run();
      }

      tx.insert(assetEvents)
        .values({
          assetId: asset.id,
          actorUserId: user.id,
          type: 'loan_item_returned',
          payload: { loanId, itemId, condition: input.returnCondition },
        })
        .run();
    });

    return c.json({ ok: true });
  });
