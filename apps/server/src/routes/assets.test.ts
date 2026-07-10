import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { assets, assetExternalIds, assetTypes, damageReports } from '../db/schema.js';
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

  describe('auditor is read-only', () => {
    it('lets an auditor read but blocks any mutation', async () => {
      const auditor = server.loginAs(
        server.createUser({ role: 'auditor', email: 'auditor@example.com' }),
      );

      const read = await server.authRequest('/api/assets', { cookie: auditor });
      expect(read.status).toBe(200);

      const create = await jsonPost(server, auditor, '/api/assets', {
        name: 'Nope',
        typeId: server.laptopTypeId,
      });
      expect(create.status).toBe(403);

      // A non-auditor role can still mutate.
      const operator = server.loginAs(
        server.createUser({ role: 'operator', email: 'op@example.com' }),
      );
      const ok = await jsonPost(server, operator, '/api/assets', {
        name: 'Yep',
        typeId: server.laptopTypeId,
      });
      expect([200, 201]).toContain(ok.status);
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

    it('treats LIKE wildcards in the search term literally', async () => {
      await jsonPost(server, cookie, '/api/assets', {
        name: 'AB_C',
        typeId: server.laptopTypeId,
      });
      await jsonPost(server, cookie, '/api/assets', {
        name: 'ABXC',
        typeId: server.laptopTypeId,
      });

      // A bare `_` is a single-char wildcard in SQL LIKE; escaped, "AB_C" must
      // match only the literal "AB_C" and not "ABXC".
      const res = await server.authRequest(`/api/assets?q=${encodeURIComponent('AB_C')}`, {
        cookie,
      });
      const names = ((await res.json()) as { items: { name: string }[] }).items.map((i) => i.name);
      expect(names).toEqual(['AB_C']);
    });

    it('paginates with limit/offset and reports the full total', async () => {
      for (let i = 0; i < 5; i++) {
        await jsonPost(server, cookie, '/api/assets', {
          name: `A${i}`,
          typeId: server.laptopTypeId,
        });
      }

      const page1 = await server.authRequest('/api/assets?limit=2&offset=0', { cookie });
      const body1 = (await page1.json()) as { items: { code: string }[]; total: number };
      expect(body1.total).toBe(5);
      expect(body1.items).toHaveLength(2);

      const page2 = await server.authRequest('/api/assets?limit=2&offset=2', { cookie });
      const body2 = (await page2.json()) as { items: { code: string }[]; total: number };
      expect(body2.items).toHaveLength(2);
      // Non-overlapping page.
      const page1Codes = body1.items.map((i) => i.code);
      expect(page1Codes).not.toContain(body2.items[0]?.code);
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
      const res = await jsonPost(server, cookie, `/api/assets/${code}/assign`, {
        userId: target.id,
      });
      expect(res.status).toBe(409);
    });

    it('lets a member unassign an asset assigned to them (self-service)', async () => {
      const member = server.createUser({ email: 'owner@example.com', role: 'member' });
      const r = await jsonPost(server, cookie, '/api/assets', {
        name: 'Mine',
        typeId: server.laptopTypeId,
      });
      const { code } = (await r.json()) as { code: string };
      await jsonPost(server, cookie, `/api/assets/${code}/assign`, { userId: member.id });

      const memberCookie = server.loginAs(member);
      const res = await jsonPost(server, memberCookie, `/api/assets/${code}/unassign`, {});
      expect(res.status).toBe(200);

      const row = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
      expect(row.status).toBe('in_stock');
      expect(row.assignedToUserId).toBeNull();
    });

    it("forbids a member from unassigning someone else's asset (403)", async () => {
      const owner = server.createUser({ email: 'owner2@example.com', role: 'member' });
      const other = server.createUser({ email: 'other@example.com', role: 'member' });
      const r = await jsonPost(server, cookie, '/api/assets', {
        name: 'Not mine',
        typeId: server.laptopTypeId,
      });
      const { code } = (await r.json()) as { code: string };
      await jsonPost(server, cookie, `/api/assets/${code}/assign`, { userId: owner.id });

      const otherCookie = server.loginAs(other);
      const res = await jsonPost(server, otherCookie, `/api/assets/${code}/unassign`, {});
      expect(res.status).toBe(403);

      const row = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
      expect(row.status).toBe('assigned');
      expect(row.assignedToUserId).toBe(owner.id);
    });
  });

  describe('POST /api/assets/bulk', () => {
    async function makeAsset(name: string) {
      const r = await jsonPost(server, cookie, '/api/assets', {
        name,
        typeId: server.laptopTypeId,
      });
      return ((await r.json()) as { code: string }).code;
    }
    async function makeLocation(name: string) {
      const r = await jsonPost(server, cookie, '/api/locations', { name });
      return ((await r.json()) as { id: string }).id;
    }

    it('moves many assets into a location in one call', async () => {
      const a = await makeAsset('A');
      const b = await makeAsset('B');
      const locId = await makeLocation('Sklad');

      const res = await jsonPost(server, cookie, '/api/assets/bulk', {
        action: 'move',
        assetCodes: [a, b],
        locationId: locId,
      });
      expect(res.status).toBe(200);
      expect((await res.json()) as { updated: number }).toEqual({ updated: 2 });

      for (const code of [a, b]) {
        const row = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
        expect(row.locationId).toBe(locId);
      }
    });

    it('assigns many assets to a user', async () => {
      const a = await makeAsset('A');
      const b = await makeAsset('B');
      const target = server.createUser({ email: 'bulk-assignee@example.com', role: 'member' });

      const res = await jsonPost(server, cookie, '/api/assets/bulk', {
        action: 'assign',
        assetCodes: [a, b],
        userId: target.id,
      });
      expect(res.status).toBe(200);
      expect((await res.json()) as { updated: number }).toEqual({ updated: 2 });

      for (const code of [a, b]) {
        const row = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
        expect(row.assignedToUserId).toBe(target.id);
        expect(row.status).toBe('assigned');
      }
    });

    it('unassigns only assets that are currently assigned', async () => {
      const a = await makeAsset('A');
      const b = await makeAsset('B'); // stays in_stock (never assigned)
      const target = server.createUser({ email: 'bulk-unassignee@example.com', role: 'member' });
      await jsonPost(server, cookie, `/api/assets/${a}/assign`, { userId: target.id });

      const res = await jsonPost(server, cookie, '/api/assets/bulk', {
        action: 'unassign',
        assetCodes: [a, b],
      });
      expect(res.status).toBe(200);
      // Only `a` was assigned, so only it counts.
      expect((await res.json()) as { updated: number }).toEqual({ updated: 1 });

      const rowA = server.db.select().from(assets).where(eq(assets.code, a)).get()!;
      expect(rowA.assignedToUserId).toBeNull();
      expect(rowA.status).toBe('in_stock');
    });

    it('archives many assets and hides them from the default list', async () => {
      const a = await makeAsset('A');
      const b = await makeAsset('B');

      const res = await jsonPost(server, cookie, '/api/assets/bulk', {
        action: 'archive',
        assetCodes: [a, b],
        status: 'retired',
      });
      expect(res.status).toBe(200);
      expect((await res.json()) as { updated: number }).toEqual({ updated: 2 });

      for (const code of [a, b]) {
        const row = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
        expect(row.status).toBe('retired');
        expect(row.archivedAt).not.toBeNull();
      }
      const list = await server.authRequest('/api/assets', { cookie });
      expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(0);
    });

    it('requires a terminal status for archive', async () => {
      const a = await makeAsset('A');
      const res = await jsonPost(server, cookie, '/api/assets/bulk', {
        action: 'archive',
        assetCodes: [a],
      });
      expect(res.status).toBe(400);
    });

    it('skips unknown codes (not counted in updated)', async () => {
      const a = await makeAsset('A');
      const res = await jsonPost(server, cookie, '/api/assets/bulk', {
        action: 'archive',
        assetCodes: [a, 'LAP-99999', 'DOES-NOT-EXIST'],
        status: 'lost',
      });
      expect(res.status).toBe(200);
      expect((await res.json()) as { updated: number }).toEqual({ updated: 1 });
    });

    it('forbids a member from bulk actions (403)', async () => {
      const a = await makeAsset('A');
      const memberCookie = server.loginAs(
        server.createUser({ role: 'member', email: 'bulk-member@example.com' }),
      );
      const res = await jsonPost(server, memberCookie, '/api/assets/bulk', {
        action: 'archive',
        assetCodes: [a],
        status: 'retired',
      });
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/assets/:code', () => {
    it('validates customFields against the type schema on update', async () => {
      server.db
        .update(assetTypes)
        .set({
          customFieldsSchema: [{ key: 'serial_number', label: 'SN', type: 'text', required: true }],
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

  describe('depreciation and kits', () => {
    async function createAsset(body: Record<string, unknown>): Promise<string> {
      const res = await jsonPost(server, cookie, '/api/assets', {
        typeId: server.laptopTypeId,
        ...body,
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { code: string }).code;
    }

    it('persists usefulLifeMonths and parentAssetId on create', async () => {
      const parentCode = await createAsset({ name: 'Kit box' });
      const parent = server.db.select().from(assets).where(eq(assets.code, parentCode)).get()!;

      const childCode = await createAsset({
        name: 'Kit part',
        usefulLifeMonths: 36,
        parentAssetId: parent.id,
      });
      const child = server.db.select().from(assets).where(eq(assets.code, childCode)).get()!;
      expect(child.usefulLifeMonths).toBe(36);
      expect(child.parentAssetId).toBe(parent.id);
    });

    it('persists usefulLifeMonths and parentAssetId on patch', async () => {
      const parentCode = await createAsset({ name: 'Kit box' });
      const parent = server.db.select().from(assets).where(eq(assets.code, parentCode)).get()!;
      const childCode = await createAsset({ name: 'Loose part' });

      const res = await jsonPatch(server, cookie, `/api/assets/${childCode}`, {
        usefulLifeMonths: 24,
        parentAssetId: parent.id,
      });
      expect(res.status).toBe(200);
      const child = server.db.select().from(assets).where(eq(assets.code, childCode)).get()!;
      expect(child.usefulLifeMonths).toBe(24);
      expect(child.parentAssetId).toBe(parent.id);
    });

    it('rejects a self-referencing parent with 400', async () => {
      const code = await createAsset({ name: 'Self kit' });
      const self = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
      const res = await jsonPatch(server, cookie, `/api/assets/${code}`, {
        parentAssetId: self.id,
      });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown parent with 400', async () => {
      const code = await createAsset({ name: 'Orphan' });
      const res = await jsonPatch(server, cookie, `/api/assets/${code}`, {
        parentAssetId: crypto.randomUUID(),
      });
      expect(res.status).toBe(400);
    });

    it('rejects the trivial two-node cycle with 400', async () => {
      const parentCode = await createAsset({ name: 'A' });
      const parent = server.db.select().from(assets).where(eq(assets.code, parentCode)).get()!;
      const childCode = await createAsset({ name: 'B', parentAssetId: parent.id });
      const child = server.db.select().from(assets).where(eq(assets.code, childCode)).get()!;

      // Now try to make the parent a child of its own child → cycle.
      const res = await jsonPatch(server, cookie, `/api/assets/${parentCode}`, {
        parentAssetId: child.id,
      });
      expect(res.status).toBe(400);
    });

    it('returns children and parent on GET /:code', async () => {
      const parentCode = await createAsset({ name: 'Kit box' });
      const parent = server.db.select().from(assets).where(eq(assets.code, parentCode)).get()!;
      const childCodeB = await createAsset({ name: 'Part B', parentAssetId: parent.id });
      const childCodeA = await createAsset({ name: 'Part A', parentAssetId: parent.id });

      const parentRes = await server.authRequest(`/api/assets/${parentCode}`, { cookie });
      const parentBody = (await parentRes.json()) as {
        children: { code: string; name: string; status: string }[];
        parent: { code: string; name: string } | null;
      };
      expect(parentBody.parent).toBeNull();
      // Ordered by code ascending.
      expect(parentBody.children.map((child) => child.code)).toEqual(
        [childCodeA, childCodeB].sort(),
      );

      const childRes = await server.authRequest(`/api/assets/${childCodeA}`, { cookie });
      const childBody = (await childRes.json()) as {
        children: unknown[];
        parent: { code: string; name: string } | null;
      };
      expect(childBody.children).toEqual([]);
      expect(childBody.parent).toEqual({ code: parentCode, name: 'Kit box' });
    });
  });

  describe('import CSV', () => {
    async function importCsv(text: string, dryRun: boolean) {
      const form = new FormData();
      form.append('file', new File([text], 'assets.csv', { type: 'text/csv' }));
      form.append('dryRun', dryRun ? 'true' : 'false');
      return server.authRequest('/api/assets/import', {
        cookie,
        method: 'POST',
        body: form,
      });
    }

    it('dry-run returns preview without inserting', async () => {
      const csv = 'name,type\r\nFoo,LAP\r\nBar,LAP\r\n';
      const res = await importCsv(csv, true);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { preview: unknown[]; created: number };
      expect(body.preview).toHaveLength(2);
      expect(body.created).toBe(0);
      const list = await server.authRequest('/api/assets', { cookie });
      expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(0);
    });

    it('commits valid rows and auto-generates codes per type', async () => {
      const csv = 'name,type\r\nFoo,LAP\r\nBar,LAP\r\n';
      const res = await importCsv(csv, false);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { created: number; preview: { code: string | null }[] };
      expect(body.created).toBe(2);
      const codes = body.preview.map((p) => p.code);
      expect(codes).toEqual([null, null]); // codes assigned at commit time, not in preview
      const list = await server.authRequest('/api/assets', { cookie });
      const items = ((await list.json()) as { items: { code: string }[] }).items;
      const sorted = items.map((i) => i.code).sort();
      expect(sorted).toEqual(['LAP-00001', 'LAP-00002']);
    });

    it('refuses to commit when any row has issues', async () => {
      const csv = 'name,type\r\nFoo,LAP\r\n,LAP\r\n'; // second row missing name
      const res = await importCsv(csv, false);
      expect(res.status).toBe(400);
      const list = await server.authRequest('/api/assets', { cookie });
      expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(0);
    });

    it('detects duplicate codes inside the CSV', async () => {
      const csv = 'code,name,type\r\nLAP-77777,A,LAP\r\nLAP-77777,B,LAP\r\n';
      const res = await importCsv(csv, true);
      const body = (await res.json()) as { preview: { issues: string[] }[]; hasErrors: boolean };
      expect(body.hasErrors).toBe(true);
      expect(body.preview[1]!.issues.some((s) => /Duplicit/i.test(s))).toBe(true);
    });

    it('detects collision with an existing code in DB', async () => {
      await jsonPost(server, cookie, '/api/assets', {
        name: 'Existing',
        code: 'LAP-88888',
        typeId: server.laptopTypeId,
      });
      const csv = 'code,name,type\r\nLAP-88888,Other,LAP\r\n';
      const res = await importCsv(csv, true);
      const body = (await res.json()) as { preview: { issues: string[] }[]; hasErrors: boolean };
      expect(body.hasErrors).toBe(true);
    });

    it('rejects non-admin/operator', async () => {
      const memberCookie = server.loginAs(
        server.createUser({ role: 'member', email: 'member@example.com' }),
      );
      const csv = 'name,type\r\nA,LAP\r\n';
      const form = new FormData();
      form.append('file', new File([csv], 'a.csv', { type: 'text/csv' }));
      form.append('dryRun', 'false');
      const res = await server.authRequest('/api/assets/import', {
        cookie: memberCookie,
        method: 'POST',
        body: form,
      });
      expect(res.status).toBe(403);
    });
  });

  describe('external IDs', () => {
    async function makeAsset(name = 'A') {
      const r = await jsonPost(server, cookie, '/api/assets', {
        name,
        typeId: server.laptopTypeId,
      });
      return ((await r.json()) as { code: string }).code;
    }

    it('add → list → remove round-trip', async () => {
      const code = await makeAsset();
      const add = await jsonPost(server, cookie, `/api/assets/${code}/external-ids`, {
        kind: 'serial',
        value: 'SN-123',
      });
      expect(add.status).toBe(201);

      const list = await server.authRequest(`/api/assets/${code}/external-ids`, { cookie });
      const body = (await list.json()) as { items: { id: string; value: string }[] };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.value).toBe('SN-123');

      const removeRes = await server.authRequest(
        `/api/assets/${code}/external-ids/${body.items[0]!.id}`,
        { cookie, method: 'DELETE' },
      );
      expect(removeRes.status).toBe(200);

      const after = server.db.select().from(assetExternalIds).all();
      expect(after).toHaveLength(0);
    });

    it('rejects duplicate (kind, value) across the org', async () => {
      const codeA = await makeAsset('A');
      const codeB = await makeAsset('B');
      await jsonPost(server, cookie, `/api/assets/${codeA}/external-ids`, {
        kind: 'serial',
        value: 'SN-DUP',
      });
      const dup = await jsonPost(server, cookie, `/api/assets/${codeB}/external-ids`, {
        kind: 'serial',
        value: 'SN-DUP',
      });
      expect(dup.status).toBe(409);
    });

    it('finds the asset by external ID via the main search', async () => {
      const codeA = await makeAsset('Match me');
      await makeAsset('Other');
      await jsonPost(server, cookie, `/api/assets/${codeA}/external-ids`, {
        kind: 'serial',
        value: 'XYZ-99999',
      });
      const res = await server.authRequest('/api/assets?q=XYZ-99999', { cookie });
      const body = (await res.json()) as { items: { name: string }[] };
      expect(body.items.map((i) => i.name)).toEqual(['Match me']);
    });

    it('cascades external IDs when the asset is deleted', async () => {
      const code = await makeAsset();
      const r = await jsonPost(server, cookie, `/api/assets/${code}/external-ids`, {
        kind: 'ean',
        value: '1234567890123',
      });
      expect(r.status).toBe(201);
      // Delete asset directly via DB (no public delete endpoint).
      const asset = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
      server.db.delete(assets).where(eq(assets.id, asset.id)).run();
      const after = server.db.select().from(assetExternalIds).all();
      expect(after).toHaveLength(0);
    });
  });

  describe('search', () => {
    it('finds an asset by external identifier stored in custom_fields', async () => {
      server.db
        .update(assetTypes)
        .set({
          customFieldsSchema: [
            { key: 'serial_number', label: 'SN', type: 'text', required: false },
          ],
        })
        .where(eq(assetTypes.id, server.laptopTypeId))
        .run();

      await jsonPost(server, cookie, '/api/assets', {
        name: 'With SN',
        typeId: server.laptopTypeId,
        customFields: { serial_number: 'SN-XYZ-12345' },
      });
      await jsonPost(server, cookie, '/api/assets', {
        name: 'Other',
        typeId: server.laptopTypeId,
      });

      const res = await server.authRequest('/api/assets?q=XYZ-12345', { cookie });
      const body = (await res.json()) as { items: { name: string }[] };
      expect(body.items.map((i) => i.name)).toEqual(['With SN']);
    });
  });

  describe('repair workflow', () => {
    it('start → finish round-trip moves through in_repair back to in_stock', async () => {
      const r = await jsonPost(server, cookie, '/api/assets', {
        name: 'Repair me',
        typeId: server.laptopTypeId,
      });
      const { code } = (await r.json()) as { code: string };

      const start = await jsonPost(server, cookie, `/api/assets/${code}/repair-start`, {});
      expect(start.status).toBe(200);
      const inRepair = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
      expect(inRepair.status).toBe('in_repair');

      const finish = await jsonPost(server, cookie, `/api/assets/${code}/repair-finish`, {});
      expect(finish.status).toBe(200);
      const back = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
      expect(back.status).toBe('in_stock');
    });

    it('refuses repair-start on an archived asset', async () => {
      const r = await jsonPost(server, cookie, '/api/assets', {
        name: 'Sold',
        typeId: server.laptopTypeId,
      });
      const { code } = (await r.json()) as { code: string };
      await jsonPost(server, cookie, `/api/assets/${code}/archive`, { status: 'sold' });

      const res = await jsonPost(server, cookie, `/api/assets/${code}/repair-start`, {});
      expect(res.status).toBe(409);
    });

    it('refuses repair-finish when the asset is not in repair', async () => {
      const r = await jsonPost(server, cookie, '/api/assets', {
        name: 'Idle',
        typeId: server.laptopTypeId,
      });
      const { code } = (await r.json()) as { code: string };
      const res = await jsonPost(server, cookie, `/api/assets/${code}/repair-finish`, {});
      expect(res.status).toBe(409);
    });
  });

  describe('audit log (events/all)', () => {
    it('lists events across all assets, newest first, with joined asset code', async () => {
      await jsonPost(server, cookie, '/api/assets', {
        name: 'A',
        typeId: server.laptopTypeId,
      });
      await jsonPost(server, cookie, '/api/assets', {
        name: 'B',
        typeId: server.laptopTypeId,
      });
      const res = await server.authRequest('/api/assets/events/all', { cookie });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { type: string; assetCode: string | null; occurredAt: string }[];
      };
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      expect(body.items.every((e) => e.type === 'created')).toBe(true);
      expect(body.items[0]!.assetCode).toMatch(/^LAP-/);
    });

    it('honours the limit query param', async () => {
      for (let i = 0; i < 5; i++) {
        await jsonPost(server, cookie, '/api/assets', {
          name: `A${i}`,
          typeId: server.laptopTypeId,
        });
      }
      const res = await server.authRequest('/api/assets/events/all?limit=2', { cookie });
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items).toHaveLength(2);
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
