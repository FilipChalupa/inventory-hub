import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { assets, assetTypes, damageReports } from '../db/schema.js';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

async function jsonPost(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function jsonPatch(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('assets API', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  describe('POST /api/assets', () => {
    it('auto-generates the code from the type prefix when none is given', async () => {
      const res = await jsonPost(server, cookie, '/api/assets', {
        name: 'MacBook Pro',
        typeId: server.laptopTypeId,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { code: string; id: string };
      expect(body.code).toBe('LAP-00001');

      const res2 = await jsonPost(server, cookie, '/api/assets', {
        name: 'Druhý',
        typeId: server.laptopTypeId,
      });
      const body2 = (await res2.json()) as { code: string };
      expect(body2.code).toBe('LAP-00002');
    });

    it('honors an explicitly supplied code', async () => {
      const res = await jsonPost(server, cookie, '/api/assets', {
        name: 'Ručně',
        code: 'LAP-09999',
        typeId: server.laptopTypeId,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('LAP-09999');
    });

    it('rejects lowercase codes at the validation layer', async () => {
      const res = await jsonPost(server, cookie, '/api/assets', {
        name: 'Lower',
        code: 'lap-00001',
        typeId: server.laptopTypeId,
      });
      expect(res.status).toBe(400);
    });

    it('rejects a duplicate code with 409', async () => {
      await jsonPost(server, cookie, '/api/assets', {
        name: 'First',
        code: 'LAP-50000',
        typeId: server.laptopTypeId,
      });
      const dup = await jsonPost(server, cookie, '/api/assets', {
        name: 'Second',
        code: 'LAP-50000',
        typeId: server.laptopTypeId,
      });
      expect(dup.status).toBe(409);
    });

    it('requires a typeId when no code is provided', async () => {
      const res = await jsonPost(server, cookie, '/api/assets', { name: 'Bez typu' });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toMatch(/typ/i);
    });

    it('returns 400 with field errors when required custom fields are missing', async () => {
      server.db
        .update(assetTypes)
        .set({
          customFieldsSchema: [
            { key: 'serial_number', label: 'Sériové číslo', type: 'text', required: true },
          ],
        })
        .where(eq(assetTypes.id, server.laptopTypeId))
        .run();

      const res = await jsonPost(server, cookie, '/api/assets', {
        name: 'No SN',
        typeId: server.laptopTypeId,
        customFields: {},
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { message: string; fields: Record<string, string> };
      };
      expect(body.error.fields.serial_number).toMatch(/povinné/i);
    });
  });

  describe('GET /api/assets', () => {
    it('hides archived assets by default and reveals them with includeArchived=true', async () => {
      const created = await jsonPost(server, cookie, '/api/assets', {
        name: 'A',
        typeId: server.laptopTypeId,
      });
      const { code } = (await created.json()) as { code: string };

      await jsonPost(server, cookie, `/api/assets/${code}/archive`, { status: 'sold' });

      const def = await server.authRequest('/api/assets', { cookie });
      expect(((await def.json()) as { items: unknown[] }).items).toHaveLength(0);

      const all = await server.authRequest('/api/assets?includeArchived=true', { cookie });
      expect(((await all.json()) as { items: unknown[] }).items).toHaveLength(1);
    });

    it('filters by status', async () => {
      const c1 = await jsonPost(server, cookie, '/api/assets', {
        name: 'in stock',
        typeId: server.laptopTypeId,
      });
      await jsonPost(server, cookie, '/api/assets', {
        name: 'will be lost',
        typeId: server.laptopTypeId,
      });
      const { code: c1Code } = (await c1.json()) as { code: string };
      // archive the second one (the latest, since list is desc by createdAt)
      const list = await server.authRequest('/api/assets', { cookie });
      const items = ((await list.json()) as { items: { code: string }[] }).items;
      const lostCode = items.find((i) => i.code !== c1Code)!.code;
      await jsonPost(server, cookie, `/api/assets/${lostCode}/archive`, { status: 'lost' });

      const stock = await server.authRequest('/api/assets?status=in_stock', { cookie });
      const stockBody = (await stock.json()) as { items: { code: string }[] };
      expect(stockBody.items.map((i) => i.code)).toEqual([c1Code]);
    });
  });

  describe('archive / unarchive', () => {
    it('archives, hides from list, then unarchives back to in_stock', async () => {
      const r = await jsonPost(server, cookie, '/api/assets', {
        name: 'Stěhovavý',
        typeId: server.laptopTypeId,
      });
      const { code } = (await r.json()) as { code: string };

      const arch = await jsonPost(server, cookie, `/api/assets/${code}/archive`, {
        status: 'retired',
        note: 'EOL',
      });
      expect(arch.status).toBe(200);

      const before = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
      expect(before.status).toBe('retired');
      expect(before.archivedAt).not.toBeNull();

      const unarch = await jsonPost(server, cookie, `/api/assets/${code}/unarchive`, {});
      expect(unarch.status).toBe(200);

      const after = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
      expect(after.status).toBe('in_stock');
      expect(after.archivedAt).toBeNull();
    });

    it('refuses to unarchive an asset that is not in a terminal state', async () => {
      const r = await jsonPost(server, cookie, '/api/assets', {
        name: 'Aktivní',
        typeId: server.laptopTypeId,
      });
      const { code } = (await r.json()) as { code: string };

      const res = await jsonPost(server, cookie, `/api/assets/${code}/unarchive`, {});
      expect(res.status).toBe(400);
    });
  });

  describe('assign / unassign', () => {
    it('cannot assign an archived asset', async () => {
      const r = await jsonPost(server, cookie, '/api/assets', {
        name: 'Lost',
        typeId: server.laptopTypeId,
      });
      const { code } = (await r.json()) as { code: string };
      await jsonPost(server, cookie, `/api/assets/${code}/archive`, { status: 'lost' });

      const target = server.createUser({ email: 'assignee@example.com', role: 'member' });
      const res = await jsonPost(server, cookie, `/api/assets/${code}/assign`, { userId: target.id });
      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /api/assets/:code', () => {
    it('validates customFields against the type schema on update', async () => {
      server.db
        .update(assetTypes)
        .set({
          customFieldsSchema: [
            { key: 'serial_number', label: 'SN', type: 'text', required: true },
          ],
        })
        .where(eq(assetTypes.id, server.laptopTypeId))
        .run();

      const r = await jsonPost(server, cookie, '/api/assets', {
        name: 'With SN',
        typeId: server.laptopTypeId,
        customFields: { serial_number: 'ABC' },
      });
      const { code } = (await r.json()) as { code: string };

      const bad = await jsonPatch(server, cookie, `/api/assets/${code}`, {
        customFields: { serial_number: '' },
      });
      expect(bad.status).toBe(400);

      const ok = await jsonPatch(server, cookie, `/api/assets/${code}`, {
        customFields: { serial_number: 'XYZ' },
      });
      expect(ok.status).toBe(200);
    });
  });

  describe('damage cleanup', () => {
    // Sanity check that the damage_reports table is wired and we can clear it
    // between tests — this guards against cross-test pollution.
    it('starts each test with an empty damage_reports table', () => {
      const rows = server.db.select().from(damageReports).all();
      expect(rows).toEqual([]);
    });
  });
});
