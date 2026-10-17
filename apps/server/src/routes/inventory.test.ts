import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { assetEvents, assets, inventorySessions } from '../db/schema.js';
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

  it('records the real time of an offline-queued scan, within bounds', async () => {
    const a = await makeAsset(server, cookie, 'A');
    const b = await makeAsset(server, cookie, 'B');
    const sid = await createSession(server, cookie);
    // The session started an hour ago; the device was offline since.
    server.db
      .update(inventorySessions)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(inventorySessions.id, sid))
      .run();
    const scanAt = async (code: string, scannedAt: string) => {
      const res = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code, scannedAt });
      expect(res.status).toBe(200);
      const events = await server.authRequest(`/api/assets/${code}/events`, { cookie });
      const items = ((await events.json()) as { items: { type: string; occurredAt: string }[] })
        .items;
      return new Date(items.find((e) => e.type === 'inventory_seen')!.occurredAt).getTime();
    };
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    const t1 = await scanAt(a, tenSecondsAgo.toISOString());
    expect(Math.abs(t1 - tenSecondsAgo.getTime())).toBeLessThan(5);
    // A far-future claim (bad device clock) falls back to the receive time.
    const t2 = await scanAt(b, new Date(Date.now() + 86_400_000).toISOString());
    expect(Math.abs(t2 - Date.now())).toBeLessThan(5_000);
    // So does one from before the session existed.
    const c = await makeAsset(server, cookie, 'C');
    const t3 = await scanAt(c, new Date(Date.now() - 7_200_000).toISOString());
    expect(Math.abs(t3 - Date.now())).toBeLessThan(5_000);
  });

  it('exports the reconciled report as CSV', async () => {
    const parent = await makeLocation(server, cookie, 'Praha');
    const loc = await makeLocation(server, cookie, 'Sklad, B', parent);
    const a = await makeAsset(server, cookie, 'Found one', loc);
    await makeAsset(server, cookie, 'Missing one', loc);
    const outside = await makeAsset(server, cookie, 'Elsewhere');
    const sid = await createSession(server, cookie, { name: 'Q4 / Praha', locationId: parent });
    await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });
    await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: outside });

    const res = await server.authRequest(`/api/inventory/${sid}/report.csv`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('inventory-Q4-Praha.csv');
    const text = (await res.text()).replace(/^\uFEFF/, '');
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('result,code,name,status,location,scanned_at,scanned_by,note');
    expect(lines.find((l) => l.startsWith(`found,${a},`))).toContain('"Praha / Sklad, B"');
    expect(lines.find((l) => l.startsWith(`found,${a},`))).toMatch(
      /,\d{4}-\d\d-\d\dT[^,]+,Test User/,
    );
    expect(lines.some((l) => l.startsWith('missing,') && l.includes('Missing one'))).toBe(true);
    expect(lines.some((l) => l.startsWith(`unexpected,${outside},`))).toBe(true);

    const none = await server.authRequest(`/api/inventory/nope/report.csv`, { cookie });
    expect(none.status).toBe(404);
  });

  it('emails admins a summary when the session is closed', async () => {
    const a = await makeAsset(server, cookie, 'Present');
    const b = await makeAsset(server, cookie, 'Gone missing');
    const sid = await createSession(server, cookie, { name: 'Sklad Q4', assetCodes: [a, b] });
    await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });
    const before = server.sentEmails.length;

    const res = await jsonPost(server, cookie, `/api/inventory/${sid}/close`, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { counts: { missing: number } }).counts.missing).toBe(1);

    const mails = server.sentEmails.slice(before);
    expect(mails.length).toBeGreaterThan(0);
    const mail = mails[0]!;
    expect(mail.subject).toContain('Sklad Q4');
    expect(mail.subject).toContain('chybí 1');
    expect(mail.text).toContain(`${b} Gone missing`);
    expect(mail.text).not.toContain(`${a} Present`);
    expect(mail.text).toContain(`/inventory/${sid}`);
    expect(mail.text).toContain('report.csv');
  });

  it('a closed report is frozen: later archiving does not rewrite it', async () => {
    const a = await makeAsset(server, cookie, 'Kept');
    const b = await makeAsset(server, cookie, 'Archived later');
    const sid = await createSession(server, cookie);
    await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });
    await jsonPost(server, cookie, `/api/inventory/${sid}/close`, {});
    server.db.update(assets).set({ archivedAt: new Date() }).where(eq(assets.code, b)).run();

    const detail = (await (
      await server.authRequest(`/api/inventory/${sid}`, { cookie })
    ).json()) as {
      session: Record<string, unknown>;
      report: { counts: Record<string, number>; missing: { code: string }[] };
    };
    expect(detail.report.counts).toMatchObject({ expected: 2, found: 1, missing: 1 });
    expect(detail.report.missing.map((m) => m.code)).toEqual([b]);
    expect(detail.session).not.toHaveProperty('expectedSnapshot');

    // Reopening goes back to the live scope (B is archived now).
    await jsonPost(server, cookie, `/api/inventory/${sid}/reopen`, {});
    const live = (await (await server.authRequest(`/api/inventory/${sid}`, { cookie })).json()) as {
      report: { counts: Record<string, number> };
    };
    expect(live.report.counts.expected).toBe(1);
  });

  it('compares with the previous stock-take', async () => {
    const a = await makeAsset(server, cookie, 'Always there');
    const b = await makeAsset(server, cookie, 'Lost this time');
    const c2 = await makeAsset(server, cookie, 'Found again');
    const d = await makeAsset(server, cookie, 'Never found');
    const e = await makeAsset(server, cookie, 'Retired');

    const scanAll = async (sid: string, codes: string[]) => {
      for (const code of codes)
        await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code });
    };
    const first = await createSession(server, cookie, { name: 'Q3' });
    await scanAll(first, [a, b, e]);
    await jsonPost(server, cookie, `/api/inventory/${first}/close`, {});
    // Q4 must be created later than Q3 (createdAt has 1 s resolution).
    server.db
      .update(inventorySessions)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(inventorySessions.id, first))
      .run();

    server.db.update(assets).set({ archivedAt: new Date() }).where(eq(assets.code, e)).run();
    const f = await makeAsset(server, cookie, 'Bought since');
    const second = await createSession(server, cookie, { name: 'Q4' });
    await scanAll(second, [a, c2, f]);

    const res = await server.authRequest(`/api/inventory/${second}/compare`, { cookie });
    expect(res.status).toBe(200);
    const cmp = (await res.json()) as Record<string, { code: string }[]> & {
      base: { name: string; sameScope: boolean };
    };
    const codes = (k: string) => cmp[k]!.map((x) => x.code);
    expect(cmp.base).toMatchObject({ name: 'Q3', sameScope: true });
    expect(codes('newlyMissing')).toEqual([b]);
    expect(codes('recovered')).toEqual([c2]);
    expect(codes('stillMissing')).toEqual([d]);
    expect(codes('addedToScope')).toEqual([f]);
    expect(codes('removedFromScope')).toEqual([e]);

    // Nothing earlier to compare with.
    const none = await server.authRequest(`/api/inventory/${first}/compare`, { cookie });
    expect(await none.json()).toEqual({ base: null });
    expect(
      (await server.authRequest(`/api/inventory/${second}/compare?with=${second}`, { cookie }))
        .status,
    ).toBe(404);
  });

  it('lists sessions with their scan counts', async () => {
    const a = await makeAsset(server, cookie, 'A');
    const b = await makeAsset(server, cookie, 'B');
    const s1 = await createSession(server, cookie, { name: 'One' });
    const s2 = await createSession(server, cookie, { name: 'Two' });
    await jsonPost(server, cookie, `/api/inventory/${s1}/scan`, { code: a });
    await jsonPost(server, cookie, `/api/inventory/${s1}/scan`, { code: b });
    const list = (await (await server.authRequest('/api/inventory', { cookie })).json()) as {
      items: { id: string; scanCount: number; expectedSnapshot?: unknown }[];
    };
    const byId = new Map(list.items.map((i) => [i.id, i]));
    expect(byId.get(s1)!.scanCount).toBe(2);
    expect(byId.get(s2)!.scanCount).toBe(0);
    expect(byId.get(s1)).not.toHaveProperty('expectedSnapshot');
  });

  it('refuses an identifier that matches several assets', async () => {
    const a = await makeAsset(server, cookie, 'A');
    const b = await makeAsset(server, cookie, 'B');
    await jsonPost(server, cookie, `/api/assets/${a}/external-ids`, {
      kind: 'serial',
      value: 'X-1',
    });
    await jsonPost(server, cookie, `/api/assets/${b}/external-ids`, { kind: 'ean', value: 'X1' });
    const sid = await createSession(server, cookie);
    const res = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: 'x1' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain(a);
    expect(body.error.message).toContain(b);
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

  it('scan returns the asset row and counts that match the full report', async () => {
    const a = await makeAsset(server, cookie, 'A');
    await makeAsset(server, cookie, 'B');
    const outside = await makeAsset(server, cookie, 'Outside');
    const sid = await createSession(server, cookie, { assetCodes: [a] });
    const res = await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: a });
    const body = (await res.json()) as {
      result: string;
      list: string;
      asset: { code: string; scannedAt: string | null };
      counts: Record<string, number>;
      report?: unknown;
    };
    expect(body).toMatchObject({ result: 'found', list: 'found', asset: { code: a } });
    expect(body.asset.scannedAt).toBeTruthy();
    expect(body.report).toBeUndefined();

    const extra = (await (
      await jsonPost(server, cookie, `/api/inventory/${sid}/scan`, { code: outside })
    ).json()) as { list: string; counts: Record<string, number> };
    expect(extra.list).toBe('unexpected');

    const full = (await (await server.authRequest(`/api/inventory/${sid}`, { cookie })).json()) as {
      report: { counts: Record<string, number> };
    };
    expect(extra.counts).toEqual(full.report.counts);
    expect(full.report.counts).toEqual({ expected: 1, found: 1, missing: 0, unexpected: 1 });
  });

  it('gzips large API responses for clients that accept it', async () => {
    for (let i = 0; i < 40; i++) await makeAsset(server, cookie, `Bulk ${i}`);
    const sid = await createSession(server, cookie);
    const res = await server.authRequest(`/api/inventory/${sid}`, {
      cookie,
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.headers.get('content-encoding')).toBe('gzip');
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
