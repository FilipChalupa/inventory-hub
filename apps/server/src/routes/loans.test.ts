import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { assetEvents, assets, damageReports, loanItems, loans } from '../db/schema.js';
import { activateDueLoans } from '../lib/loanActivation.js';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

async function jsonPost(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function makeAsset(
  server: TestServer,
  cookie: string,
  name: string,
): Promise<string> {
  const res = await jsonPost(server, cookie, '/api/assets', {
    name,
    typeId: server.laptopTypeId,
  });
  return ((await res.json()) as { code: string }).code;
}

describe('loans API', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  describe('POST /api/loans', () => {
    it('creates a loan, marks each asset on_loan, and logs loan_started events', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      const b = await makeAsset(server, cookie, 'Asset B');

      const res = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Jan Novák',
        assetCodes: [a, b],
      });
      expect(res.status).toBe(201);

      const aRow = server.db.select().from(assets).where(eq(assets.code, a)).get()!;
      const bRow = server.db.select().from(assets).where(eq(assets.code, b)).get()!;
      expect(aRow.status).toBe('on_loan');
      expect(bRow.status).toBe('on_loan');
    });

    it('trims the borrower name and rejects a whitespace-only one', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      const padded = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: '  Jan Novák  ',
        assetCodes: [a],
      });
      expect(padded.status).toBe(201);
      const { id } = (await padded.json()) as { id: string };
      const row = server.db.select().from(loans).where(eq(loans.id, id)).get()!;
      expect(row.borrowerName).toBe('Jan Novák');

      const b = await makeAsset(server, cookie, 'Asset B');
      const blank = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: '   ',
        assetCodes: [b],
      });
      expect(blank.status).toBe(400);
    });

    it('rejects when an asset code does not exist', async () => {
      const res = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: ['LAP-99999'],
      });
      expect(res.status).toBe(400);
    });

    it('rejects when an asset is already on loan (409)', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      const first = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'První',
        assetCodes: [a],
      });
      expect(first.status).toBe(201);

      const second = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Druhý',
        assetCodes: [a],
      });
      expect(second.status).toBe(409);
    });

    it('rejects when an asset is archived', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      await jsonPost(server, cookie, `/api/assets/${a}/archive`, { status: 'sold' });
      const res = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      expect(res.status).toBe(409);
    });
  });

  describe('planned loans', () => {
    const future = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const past = () => new Date(Date.now() - 60 * 1000).toISOString();

    it('a future start date reserves assets without marking them on_loan', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Plán',
        loanedAt: future(),
        assetCodes: [a],
      });
      expect(created.status).toBe(201);
      const { id: loanId } = (await created.json()) as { id: string };

      const row = server.db.select().from(assets).where(eq(assets.code, a)).get()!;
      expect(row.status).toBe('in_stock');

      const list = await server.authRequest('/api/loans', { cookie });
      const body = (await list.json()) as { items: { id: string; status: string }[] };
      expect(body.items.find((l) => l.id === loanId)!.status).toBe('planned');
    });

    it('a reserved asset cannot be booked again (409)', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      const first = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Plán',
        loanedAt: future(),
        assetCodes: [a],
      });
      expect(first.status).toBe(201);

      const second = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Kolize',
        assetCodes: [a],
      });
      expect(second.status).toBe(409);
    });

    const day = 24 * 60 * 60 * 1000;
    const inDays = (n: number) => new Date(Date.now() + n * day).toISOString();

    it('allows non-overlapping reservations on the same asset', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      const first = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Týden 1',
        loanedAt: inDays(2),
        expectedReturnAt: inDays(4),
        assetCodes: [a],
      });
      expect(first.status).toBe(201);

      const second = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Týden 2',
        loanedAt: inDays(5),
        expectedReturnAt: inDays(7),
        assetCodes: [a],
      });
      expect(second.status).toBe(201);
    });

    it('allows a back-to-back reservation starting exactly when the previous ends', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'A',
        loanedAt: inDays(2),
        expectedReturnAt: inDays(4),
        assetCodes: [a],
      });
      const res = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'B',
        loanedAt: inDays(4),
        expectedReturnAt: inDays(6),
        assetCodes: [a],
      });
      expect(res.status).toBe(201);
    });

    it('rejects an overlapping reservation on the same asset (409)', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'A',
        loanedAt: inDays(2),
        expectedReturnAt: inDays(6),
        assetCodes: [a],
      });
      const res = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'B',
        loanedAt: inDays(4),
        expectedReturnAt: inDays(5),
        assetCodes: [a],
      });
      expect(res.status).toBe(409);
    });

    it('an open-ended loan (no return date) blocks later reservations', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'A',
        loanedAt: inDays(2),
        assetCodes: [a],
      });
      const res = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'B',
        loanedAt: inDays(5),
        expectedReturnAt: inDays(6),
        assetCodes: [a],
      });
      expect(res.status).toBe(409);
    });

    it('rejects a loan whose return is before its start (400)', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      const res = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Špatně',
        loanedAt: inDays(5),
        expectedReturnAt: inDays(3),
        assetCodes: [a],
      });
      expect(res.status).toBe(400);
    });

    it('POST /:id/start activates a planned loan and marks assets on_loan', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Plán',
        loanedAt: future(),
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };

      const start = await jsonPost(server, cookie, `/api/loans/${loanId}/start`, {});
      expect(start.status).toBe(200);

      const row = server.db.select().from(assets).where(eq(assets.code, a)).get()!;
      expect(row.status).toBe('on_loan');

      const detail = await server.authRequest(`/api/loans/${loanId}`, { cookie });
      const body = (await detail.json()) as { loan: { status: string } };
      expect(body.loan.status).toBe('open');

      // starting again is rejected
      const again = await jsonPost(server, cookie, `/api/loans/${loanId}/start`, {});
      expect(again.status).toBe(409);
    });

    it('activateDueLoans activates planned loans whose start moment has passed', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Plán',
        loanedAt: future(),
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };

      // Pretend the planned start has now arrived.
      server.db
        .update(loans)
        .set({ loanedAt: new Date(Date.now() - 1000) })
        .where(eq(loans.id, loanId))
        .run();

      const { activated } = activateDueLoans(server.db);
      expect(activated).toBe(1);

      const row = server.db.select().from(assets).where(eq(assets.code, a)).get()!;
      expect(row.status).toBe('on_loan');
      const loanRow = server.db.select().from(loans).where(eq(loans.id, loanId)).get()!;
      expect(loanRow.startedAt).not.toBeNull();
    });

    it('availability offers a borrowed asset for a window after its expected return', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      // Active loan returning in ~3 days.
      await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Teď',
        expectedReturnAt: inDays(3),
        assetCodes: [a],
      });

      // Right now the asset is out → listed but not available for an
      // immediate window.
      const nowList = await server.authRequest('/api/loans/availability', { cookie });
      const nowBody = (await nowList.json()) as {
        items: { code: string; available: boolean; reason?: string }[];
      };
      const nowRow = nowBody.items.find((x) => x.code === a);
      expect(nowRow).toBeTruthy();
      expect(nowRow!.available).toBe(false);

      // A window starting after the return is available — even though the
      // asset is currently on_loan.
      const laterList = await server.authRequest(
        `/api/loans/availability?from=${encodeURIComponent(inDays(5))}`,
        { cookie },
      );
      const laterBody = (await laterList.json()) as {
        items: { code: string; status: string; available: boolean }[];
      };
      const offered = laterBody.items.find((x) => x.code === a);
      expect(offered).toBeTruthy();
      expect(offered!.available).toBe(true);
      expect(offered!.status).toBe('on_loan');

      // And it can actually be reserved for that window.
      const reserve = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Příště',
        loanedAt: inDays(5),
        expectedReturnAt: inDays(7),
        assetCodes: [a],
      });
      expect(reserve.status).toBe(201);
    });

    it('lists a non-loanable asset (in repair) as unavailable with a reason', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      await jsonPost(server, cookie, `/api/assets/${a}/repair-start`, {});

      const list = await server.authRequest('/api/loans/availability', { cookie });
      const body = (await list.json()) as {
        items: { code: string; available: boolean; reason?: string }[];
      };
      const row = body.items.find((x) => x.code === a);
      expect(row).toBeTruthy();
      expect(row!.available).toBe(false);
      expect(row!.reason).toBe('v opravě');

      // And it is rejected if someone tries to loan it directly.
      const res = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      expect(res.status).toBe(409);
    });

    it('a past start date creates the loan as already active', async () => {
      const a = await makeAsset(server, cookie, 'Asset A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Hned',
        loanedAt: past(),
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };

      const row = server.db.select().from(assets).where(eq(assets.code, a)).get()!;
      expect(row.status).toBe('on_loan');

      const detail = await server.authRequest(`/api/loans/${loanId}`, { cookie });
      const body = (await detail.json()) as { loan: { status: string } };
      expect(body.loan.status).toBe('open');
    });
  });

  describe('GET /api/loans pagination & search', () => {
    it('paginates with limit/offset, reports total, and filters by borrower', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const b = await makeAsset(server, cookie, 'B');
      await jsonPost(server, cookie, '/api/loans', { borrowerName: 'Alice', assetCodes: [a] });
      await jsonPost(server, cookie, '/api/loans', { borrowerName: 'Bob', assetCodes: [b] });

      const page = await server.authRequest('/api/loans?limit=1', { cookie });
      const body = (await page.json()) as { items: unknown[]; total: number };
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(1);

      const search = await server.authRequest('/api/loans?q=ali', { cookie });
      const sbody = (await search.json()) as { items: { borrowerName: string }[]; total: number };
      expect(sbody.total).toBe(1);
      expect(sbody.items[0]!.borrowerName).toBe('Alice');
    });
  });

  describe('GET /api/loans', () => {
    it('reports derived loan status (open / partially_returned / fully_returned)', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const b = await makeAsset(server, cookie, 'B');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'P. Strom',
        assetCodes: [a, b],
      });
      const { id: loanId } = (await created.json()) as { id: string };

      // open
      const list1 = await server.authRequest('/api/loans', { cookie });
      const body1 = (await list1.json()) as {
        items: { id: string; status: string }[];
      };
      expect(body1.items.find((l) => l.id === loanId)!.status).toBe('open');

      // return one item
      const detail = await server.authRequest(`/api/loans/${loanId}`, { cookie });
      const detailBody = (await detail.json()) as { loan: { items: { id: string }[] } };
      const firstItemId = detailBody.loan.items[0]!.id;
      const ret = await jsonPost(
        server,
        cookie,
        `/api/loans/${loanId}/items/${firstItemId}/return`,
        { returnCondition: 'ok' },
      );
      expect(ret.status).toBe(200);

      const list2 = await server.authRequest('/api/loans', { cookie });
      const body2 = (await list2.json()) as {
        items: { id: string; status: string }[];
      };
      expect(body2.items.find((l) => l.id === loanId)!.status).toBe('partially_returned');

      // return the other
      const secondItemId = detailBody.loan.items[1]!.id;
      await jsonPost(
        server,
        cookie,
        `/api/loans/${loanId}/items/${secondItemId}/return`,
        { returnCondition: 'ok' },
      );

      const list3 = await server.authRequest('/api/loans', { cookie });
      const body3 = (await list3.json()) as {
        items: { id: string; status: string }[];
      };
      expect(body3.items.find((l) => l.id === loanId)!.status).toBe('fully_returned');
    });
  });

  describe('edit & cancel', () => {
    const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

    async function jsonReq(method: string, path: string, body?: unknown) {
      return server.authRequest(path, {
        cookie,
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
    }

    it('cancels a planned loan (DELETE) and frees the reservation', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Plán',
        loanedAt: inDays(3),
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };

      const del = await jsonReq('DELETE', `/api/loans/${loanId}`);
      expect(del.status).toBe(200);

      // Loan gone, asset still in stock and bookable again immediately.
      const detail = await server.authRequest(`/api/loans/${loanId}`, { cookie });
      expect(detail.status).toBe(404);
      const reuse = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Nový',
        assetCodes: [a],
      });
      expect(reuse.status).toBe(201);
    });

    it('refuses to delete a started loan', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Aktivní',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const del = await jsonReq('DELETE', `/api/loans/${loanId}`);
      expect(del.status).toBe(409);
    });

    it('edits borrower and purpose (PATCH)', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Před',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };

      const patch = await jsonReq('PATCH', `/api/loans/${loanId}`, {
        borrowerName: 'Po',
        purpose: 'Konference',
      });
      expect(patch.status).toBe(200);

      const detail = await server.authRequest(`/api/loans/${loanId}`, { cookie });
      const body = (await detail.json()) as { loan: { borrowerName: string; purpose: string } };
      expect(body.loan.borrowerName).toBe('Po');
      expect(body.loan.purpose).toBe('Konference');
    });

    it('rejects changing the start of a started loan', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Aktivní',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const patch = await jsonReq('PATCH', `/api/loans/${loanId}`, { loanedAt: inDays(2) });
      expect(patch.status).toBe(409);
    });

    it('rejects an edit whose new window collides with another loan', async () => {
      const a = await makeAsset(server, cookie, 'A');
      // Reservation 1: days 2–4.
      await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'R1',
        loanedAt: inDays(2),
        expectedReturnAt: inDays(4),
        assetCodes: [a],
      });
      // Reservation 2: days 6–8 (planned), which we'll try to move onto R1.
      const r2 = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'R2',
        loanedAt: inDays(6),
        expectedReturnAt: inDays(8),
        assetCodes: [a],
      });
      const { id: r2Id } = (await r2.json()) as { id: string };

      const patch = await jsonReq('PATCH', `/api/loans/${r2Id}`, {
        loanedAt: inDays(3),
        expectedReturnAt: inDays(5),
      });
      expect(patch.status).toBe(409);
    });

    it('logs a loan_updated event with a diff when edited', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Před',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };

      await jsonReq('PATCH', `/api/loans/${loanId}`, { borrowerName: 'Po' });

      const assetId = server.db.select().from(assets).where(eq(assets.code, a)).get()!.id;
      const events = server.db
        .select()
        .from(assetEvents)
        .where(eq(assetEvents.assetId, assetId))
        .all();
      const updated = events.find((e) => e.type === 'loan_updated');
      expect(updated).toBeTruthy();
      expect((updated!.payload as { changes: { borrowerName?: unknown } }).changes.borrowerName).toEqual(
        { from: 'Před', to: 'Po' },
      );
    });

    it('adds an item to an active loan (asset → on_loan, logged)', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const b = await makeAsset(server, cookie, 'B');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };

      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/items`, { assetCodes: [b] });
      expect(res.status).toBe(200);

      expect(server.db.select().from(assets).where(eq(assets.code, b)).get()!.status).toBe('on_loan');
      const bId = server.db.select().from(assets).where(eq(assets.code, b)).get()!.id;
      const added = server.db
        .select()
        .from(assetEvents)
        .where(eq(assetEvents.assetId, bId))
        .all()
        .find((e) => e.type === 'loan_item_added');
      expect(added).toBeTruthy();
    });

    it('refuses to add an asset already in the loan', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/items`, { assetCodes: [a] });
      expect(res.status).toBe(409);
    });

    it('removes an item from an active loan (asset → in_stock, logged)', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const b = await makeAsset(server, cookie, 'B');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a, b],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const bId = server.db.select().from(assets).where(eq(assets.code, b)).get()!.id;
      const itemB = server.db
        .select()
        .from(loanItems)
        .where(and(eq(loanItems.loanId, loanId), eq(loanItems.assetId, bId)))
        .get()!;

      const res = await jsonReq('DELETE', `/api/loans/${loanId}/items/${itemB.id}`);
      expect(res.status).toBe(200);

      expect(server.db.select().from(assets).where(eq(assets.code, b)).get()!.status).toBe('in_stock');
      const removed = server.db
        .select()
        .from(assetEvents)
        .where(eq(assetEvents.assetId, bId))
        .all()
        .find((e) => e.type === 'loan_item_removed');
      expect(removed).toBeTruthy();
    });

    it('refuses to remove the last remaining item', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const item = server.db.select().from(loanItems).where(eq(loanItems.loanId, loanId)).get()!;
      const res = await jsonReq('DELETE', `/api/loans/${loanId}/items/${item.id}`);
      expect(res.status).toBe(409);
    });

    it('resets the overdue flag when the return date changes', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      server.db.update(loans).set({ overdueNotifiedAt: new Date() }).where(eq(loans.id, loanId)).run();

      await jsonReq('PATCH', `/api/loans/${loanId}`, { expectedReturnAt: inDays(5) });

      const row = server.db.select().from(loans).where(eq(loans.id, loanId)).get()!;
      expect(row.overdueNotifiedAt).toBeNull();
    });

    it('resets the start-reminder flag when a planned start changes', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        loanedAt: inDays(3),
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      server.db
        .update(loans)
        .set({ startReminderSentAt: new Date() })
        .where(eq(loans.id, loanId))
        .run();

      await jsonReq('PATCH', `/api/loans/${loanId}`, { loanedAt: inDays(5) });

      const row = server.db.select().from(loans).where(eq(loans.id, loanId)).get()!;
      expect(row.startReminderSentAt).toBeNull();
    });

    it('exposes a per-loan activity log including the edit diff', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Před',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      await jsonReq('PATCH', `/api/loans/${loanId}`, { borrowerName: 'Po' });

      const res = await server.authRequest(`/api/loans/${loanId}/events`, { cookie });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: {
          type: string;
          actorName: string | null;
          payload: { changes?: Record<string, { from: unknown; to: unknown }> };
        }[];
      };
      const types = body.items.map((i) => i.type);
      expect(types).toContain('loan_started');
      expect(types).toContain('loan_updated');
      const upd = body.items.find((i) => i.type === 'loan_updated')!;
      expect(upd.payload.changes!.borrowerName).toEqual({ from: 'Před', to: 'Po' });
      expect(upd.actorName).toBeTruthy();
    });

    it('for-asset lists active and planned commitments', async () => {
      const a = await makeAsset(server, cookie, 'A');
      await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Aktivní',
        expectedReturnAt: inDays(5),
        assetCodes: [a],
      });
      await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'Plán',
        loanedAt: inDays(10),
        expectedReturnAt: inDays(12),
        assetCodes: [a],
      });

      const res = await server.authRequest(`/api/loans/for-asset/${a}`, { cookie });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { borrowerName: string; status: string }[] };
      expect(body.items).toHaveLength(2);
      expect(body.items.map((i) => i.status).sort()).toEqual(['active', 'planned']);
    });
  });

  describe('return flow', () => {
    it('returning ok puts the asset back to in_stock', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const itemId = server.db.select().from(loanItems).where(eq(loanItems.loanId, loanId)).get()!.id;

      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/items/${itemId}/return`, {
        returnCondition: 'ok',
      });
      expect(res.status).toBe(200);

      const row = server.db.select().from(assets).where(eq(assets.code, a)).get()!;
      expect(row.status).toBe('in_stock');
    });

    it('returning damaged moves the asset to in_repair and creates a damage report', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const itemId = server.db.select().from(loanItems).where(eq(loanItems.loanId, loanId)).get()!.id;

      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/items/${itemId}/return`, {
        returnCondition: 'damaged',
        returnNotes: 'Rozbitá klávesnice',
      });
      expect(res.status).toBe(200);

      const row = server.db.select().from(assets).where(eq(assets.code, a)).get()!;
      expect(row.status).toBe('in_repair');

      const reports = server.db
        .select()
        .from(damageReports)
        .where(eq(damageReports.assetId, row.id))
        .all();
      expect(reports).toHaveLength(1);
      expect(reports[0]!.description).toBe('Rozbitá klávesnice');
      expect(reports[0]!.severity).toBe('minor');
    });

    it('return-all returns every open item and puts assets back in_stock', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const b = await makeAsset(server, cookie, 'B');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a, b],
      });
      const { id: loanId } = (await created.json()) as { id: string };

      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/return-all`, {});
      expect(res.status).toBe(200);
      expect(((await res.json()) as { returned: number }).returned).toBe(2);

      expect(server.db.select().from(assets).where(eq(assets.code, a)).get()!.status).toBe(
        'in_stock',
      );
      expect(server.db.select().from(assets).where(eq(assets.code, b)).get()!.status).toBe(
        'in_stock',
      );

      const detail = await server.authRequest(`/api/loans/${loanId}`, { cookie });
      const body = (await detail.json()) as { loan: { status: string } };
      expect(body.loan.status).toBe('fully_returned');
    });

    it('return-all accepts a backdated return date', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      server.db.update(loans).set({ loanedAt: weekAgo, startedAt: weekAgo }).where(eq(loans.id, loanId)).run();

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/return-all`, {
        returnedAt: yesterday.toISOString(),
      });
      expect(res.status).toBe(200);

      const itemId = server.db.select().from(loanItems).where(eq(loanItems.loanId, loanId)).get()!.id;
      const row = server.db.select().from(loanItems).where(eq(loanItems.id, itemId)).get()!;
      expect(row.returnedAt!.getTime()).toBe(yesterday.getTime());
    });

    it('return-all rejects a future return date', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/return-all`, {
        returnedAt: tomorrow.toISOString(),
      });
      expect(res.status).toBe(400);
    });

    it('return-all only touches still-open items and 409s when nothing is open', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const b = await makeAsset(server, cookie, 'B');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a, b],
      });
      const { id: loanId } = (await created.json()) as { id: string };

      // Return one item up front as damaged.
      const firstItem = server.db
        .select()
        .from(loanItems)
        .where(eq(loanItems.loanId, loanId))
        .all()[0]!;
      await jsonPost(server, cookie, `/api/loans/${loanId}/items/${firstItem.id}/return`, {
        returnCondition: 'damaged',
      });

      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/return-all`, {});
      expect(res.status).toBe(200);
      expect(((await res.json()) as { returned: number }).returned).toBe(1);

      // The already-damaged item keeps its condition.
      const stillDamaged = server.db
        .select()
        .from(loanItems)
        .where(eq(loanItems.id, firstItem.id))
        .get()!;
      expect(stillDamaged.returnCondition).toBe('damaged');

      // Nothing open now → 409.
      const again = await jsonPost(server, cookie, `/api/loans/${loanId}/return-all`, {});
      expect(again.status).toBe(409);
    });

    it('records a custom (backdated) return date', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const itemId = server.db.select().from(loanItems).where(eq(loanItems.loanId, loanId)).get()!.id;

      // Pretend the loan started a week ago so a backdated return is valid.
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      server.db.update(loans).set({ loanedAt: weekAgo, startedAt: weekAgo }).where(eq(loans.id, loanId)).run();

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/items/${itemId}/return`, {
        returnCondition: 'ok',
        returnedAt: yesterday.toISOString(),
      });
      expect(res.status).toBe(200);

      const row = server.db.select().from(loanItems).where(eq(loanItems.id, itemId)).get()!;
      expect(row.returnedAt!.getTime()).toBe(yesterday.getTime());
    });

    it('rejects a return date in the future', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const itemId = server.db.select().from(loanItems).where(eq(loanItems.loanId, loanId)).get()!.id;

      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/items/${itemId}/return`, {
        returnCondition: 'ok',
        returnedAt: tomorrow.toISOString(),
      });
      expect(res.status).toBe(400);
    });

    it('rejects a return date before the loan started', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const itemId = server.db.select().from(loanItems).where(eq(loanItems.loanId, loanId)).get()!.id;

      const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const res = await jsonPost(server, cookie, `/api/loans/${loanId}/items/${itemId}/return`, {
        returnCondition: 'ok',
        returnedAt: longAgo.toISOString(),
      });
      expect(res.status).toBe(400);
    });

    it('refuses to return the same item twice', async () => {
      const a = await makeAsset(server, cookie, 'A');
      const created = await jsonPost(server, cookie, '/api/loans', {
        borrowerName: 'X',
        assetCodes: [a],
      });
      const { id: loanId } = (await created.json()) as { id: string };
      const itemId = server.db.select().from(loanItems).where(eq(loanItems.loanId, loanId)).get()!.id;

      const first = await jsonPost(server, cookie, `/api/loans/${loanId}/items/${itemId}/return`, {
        returnCondition: 'ok',
      });
      expect(first.status).toBe(200);

      const second = await jsonPost(server, cookie, `/api/loans/${loanId}/items/${itemId}/return`, {
        returnCondition: 'ok',
      });
      expect(second.status).toBe(409);
    });
  });
});
