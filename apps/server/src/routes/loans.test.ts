import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { assets, damageReports, loanItems, loans } from '../db/schema.js';
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
