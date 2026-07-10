import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { assetEvents, assets } from '../db/schema.js';
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
  locationId?: string,
): Promise<string> {
  const res = await jsonPost(server, cookie, '/api/assets', {
    name,
    typeId: server.laptopTypeId,
    locationId,
  });
  return ((await res.json()) as { code: string }).code;
}

async function makeLocation(
  server: TestServer,
  cookie: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const res = await jsonPost(server, cookie, '/api/locations', { name, parentId });
  return ((await res.json()) as { id: string }).id;
}

async function createSession(
  server: TestServer,
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await jsonPost(server, cookie, '/api/inventory', body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { session: { id: string } }).session.id;
}

describe('inventory API', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  it('creates an open session with a default name', async () => {
    const res = await jsonPost(server, cookie, '/api/inventory', {});
    expect(res.status).toBe(201);
    const { session } = (await res.json()) as { session: { name: string; status: string } };
    expect(session.status).toBe('open');
    expect(session.name).toMatch(/Inventura/);
  });

  it('reconciles found vs missing for a whole-org session', async () => {
    const a = await makeAsset(server, cookie, 'A');
    await makeAsset(server, cookie, 'B'); // never scanned → missing
    const sid = await createSession(server, cookie);

    const scanRes = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });
    expect(scanRes.status).toBe(200);
    expect(((await scanRes.json()) as { result: string }).result).toBe('found');

    const detail = await (await server.authRequest(`/api/inventory/${sid}`, { cookie })).json();
    const report = (
      detail as { report: { counts: Record<string, number>; missing: { code: string }[] } }
    ).report;
    expect(report.counts.expected).toBe(2);
    expect(report.counts.found).toBe(1);
    expect(report.counts.missing).toBe(1);
    expect(report.missing.map((m) => m.code)).toContain(
      (await server.db.select().from(assets).all()).find((x) => x.name === 'B')!.code,
    );
  });

  it('treats a second scan of the same asset as idempotent (already)', async () => {
    const a = await makeAsset(server, cookie, 'A');
    const sid = await createSession(server, cookie);
    await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });
    const again = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });
    expect(((await again.json()) as { result: string }).result).toBe('already');

    const detail = await (await server.authRequest(`/api/inventory/${sid}`, { cookie })).json();
    expect((detail as { report: { counts: { found: number } } }).report.counts.found).toBe(1);
  });

  it('stamps lastSeenAt and logs an inventory_seen event on scan', async () => {
    const a = await makeAsset(server, cookie, 'A');
    const sid = await createSession(server, cookie);
    await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });

    const row = server.db.select().from(assets).where(eq(assets.code, a)).get()!;
    expect(row.lastSeenAt).not.toBeNull();
    const events = server.db
      .select()
      .from(assetEvents)
      .where(eq(assetEvents.assetId, row.id))
      .all();
    expect(events.some((e) => e.type === 'inventory_seen')).toBe(true);
  });

  it('scopes by location subtree; out-of-scope scans are unexpected', async () => {
    const building = await makeLocation(server, cookie, 'Budova');
    const room = await makeLocation(server, cookie, 'Místnost', building);
    const elsewhere = await makeLocation(server, cookie, 'Jinde');

    const inRoom = await makeAsset(server, cookie, 'V místnosti', room);
    const outside = await makeAsset(server, cookie, 'Jinde', elsewhere);

    const sid = await createSession(server, cookie, { locationId: building });

    // Asset in a child location counts as expected + found.
    const r1 = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: inRoom });
    expect(((await r1.json()) as { result: string }).result).toBe('found');

    // Asset in an unrelated location is unexpected.
    const r2 = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: outside });
    expect(((await r2.json()) as { result: string }).result).toBe('unexpected');

    const detail = await (await server.authRequest(`/api/inventory/${sid}`, { cookie })).json();
    const report = (detail as { report: { counts: Record<string, number> } }).report;
    expect(report.counts.expected).toBe(1);
    expect(report.counts.found).toBe(1);
    expect(report.counts.unexpected).toBe(1);
  });

  it('marks missing assets as lost (archived)', async () => {
    const a = await makeAsset(server, cookie, 'A');
    const missing = await makeAsset(server, cookie, 'Missing');
    const sid = await createSession(server, cookie);
    await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });

    const res = await jsonPost(server, cookie, `/api/inventory/${sid}/mark-lost`, {
      codes: [missing],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { archived: number }).archived).toBe(1);

    const row = server.db.select().from(assets).where(eq(assets.code, missing)).get()!;
    expect(row.status).toBe('lost');
    expect(row.archivedAt).not.toBeNull();
  });

  it('closes a session and blocks further scans', async () => {
    const a = await makeAsset(server, cookie, 'A');
    const sid = await createSession(server, cookie);
    const closeRes = await jsonPost(server, cookie, `/api/inventory/${sid}/close`, {});
    expect(closeRes.status).toBe(200);

    const scanRes = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });
    expect(scanRes.status).toBe(409);
  });

  it('returns 404 when scanning an unknown code', async () => {
    const sid = await createSession(server, cookie);
    const res = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: 'LAP-99999' });
    expect(res.status).toBe(404);
  });

  it('forbids non-write roles from creating or scanning', async () => {
    const memberCookie = server.loginAs(server.createUser({ role: 'member' }));
    const create = await jsonPost(server, memberCookie, '/api/inventory', {});
    expect(create.status).toBe(403);

    // A session created by admin still can't be scanned by a member.
    const sid = await createSession(server, cookie);
    const scan = await jsonPost(server, memberCookie, `/api/inventory/${sid}/scan`, {
      code: 'LAP-00001',
    });
    expect(scan.status).toBe(403);
  });

  it('lets any authenticated role read the report', async () => {
    const sid = await createSession(server, cookie);
    const auditorCookie = server.loginAs(server.createUser({ role: 'auditor' }));
    const res = await server.authRequest(`/api/inventory/${sid}`, { cookie: auditorCookie });
    expect(res.status).toBe(200);
  });

  it('scan returns the freshly reconciled report for live updates', async () => {
    const a = await makeAsset(server, cookie, 'A');
    await makeAsset(server, cookie, 'B');
    const sid = await createSession(server, cookie);

    const res = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });
    const body = (await res.json()) as {
      result: string;
      report: { counts: { found: number }; found: { code: string }[] };
    };
    expect(body.result).toBe('found');
    expect(body.report.counts.found).toBe(1);
    expect(body.report.found.map((x) => x.code)).toContain(a);
  });

  it('scopes by asset type', async () => {
    const typeRes = await jsonPost(server, cookie, '/api/asset-types', {
      name: 'Monitor',
      codePrefix: 'MON',
    });
    const monTypeId = ((await typeRes.json()) as { id: string }).id;
    const monRes = await jsonPost(server, cookie, '/api/assets', {
      name: 'Mon',
      typeId: monTypeId,
    });
    const monCode = ((await monRes.json()) as { code: string }).code;
    await makeAsset(server, cookie, 'Laptop'); // laptop type — outside scope

    const sid = await createSession(server, cookie, { typeIds: [monTypeId] });
    const detail = await (await server.authRequest(`/api/inventory/${sid}`, { cookie })).json();
    const report = (
      detail as { report: { counts: Record<string, number>; missing: { code: string }[] } }
    ).report;
    expect(report.counts.expected).toBe(1);
    expect(report.missing.map((m) => m.code)).toEqual([monCode]);
  });

  it('scopes to a hand-picked asset list (codes)', async () => {
    const a = await makeAsset(server, cookie, 'Picked');
    const b = await makeAsset(server, cookie, 'NotPicked');

    const sid = await createSession(server, cookie, { assetCodes: [a] });
    expect(
      (
        (await (await server.authRequest(`/api/inventory/${sid}`, { cookie })).json()) as {
          report: { counts: { expected: number } };
        }
      ).report.counts.expected,
    ).toBe(1);

    // The non-picked asset is out of scope → unexpected when scanned.
    const r = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: b });
    expect(((await r.json()) as { result: string }).result).toBe('unexpected');
  });

  it('rejects a picked asset list with an unknown code', async () => {
    const res = await jsonPost(server, cookie, '/api/inventory', { assetCodes: ['LAP-99999'] });
    expect(res.status).toBe(400);
  });

  it('stores and clears a per-item note, surfaced in the report', async () => {
    const a = await makeAsset(server, cookie, 'A');
    const sid = await createSession(server, cookie);
    const assetId = server.db.select().from(assets).where(eq(assets.code, a)).get()!.id;

    const setRes = await server.authRequest(`/api/inventory/${sid}/items/${assetId}/note`, {
      cookie,
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'poškozená krabice' }),
    });
    expect(setRes.status).toBe(200);
    const setBody = (await setRes.json()) as {
      report: { missing: { code: string; note: string | null }[] };
    };
    expect(setBody.report.missing.find((m) => m.code === a)?.note).toBe('poškozená krabice');

    const clearRes = await server.authRequest(`/api/inventory/${sid}/items/${assetId}/note`, {
      cookie,
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: '' }),
    });
    const clearBody = (await clearRes.json()) as {
      report: { missing: { code: string; note: string | null }[] };
    };
    expect(clearBody.report.missing.find((m) => m.code === a)?.note).toBeNull();
  });

  it('updates the session note via PATCH', async () => {
    const sid = await createSession(server, cookie);
    const res = await server.authRequest(`/api/inventory/${sid}`, {
      cookie,
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'obecná poznámka' }),
    });
    expect(res.status).toBe(200);
    const detail = (await (
      await server.authRequest(`/api/inventory/${sid}`, { cookie })
    ).json()) as {
      session: { note: string | null };
    };
    expect(detail.session.note).toBe('obecná poznámka');
  });
});
