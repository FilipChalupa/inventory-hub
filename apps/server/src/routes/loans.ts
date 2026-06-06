import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { createLoanInput, returnLoanItemInput, deriveLoanStatus } from '@inventory-hub/shared';
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

    // An asset may only be part of one active or planned loan at a time.
    // Any not-yet-returned loan item on a target asset is a conflict — this
    // covers both currently borrowed and already reserved (planned) assets.
    const targetIds = targets.map((t) => t.id);
    const conflicts = db
      .select({ code: assets.code })
      .from(loanItems)
      .innerJoin(assets, eq(loanItems.assetId, assets.id))
      .where(and(inArray(loanItems.assetId, targetIds), isNull(loanItems.returnedAt)))
      .all();
    if (conflicts.length) {
      const codesList = [...new Set(conflicts.map((x) => x.code))];
      return c.json(
        {
          error: {
            message: `Asset(y) jsou už ve výpůjčce nebo rezervaci: ${codesList.join(', ')}`,
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
