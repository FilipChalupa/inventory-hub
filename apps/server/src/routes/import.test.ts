import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { assetTypes, assets, damageReports, loanItems, loans, locations } from '../db/schema.js';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

function postImport(server: TestServer, cookie: string, body: unknown) {
  return server.authRequest('/api/import', {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const sampleBody = {
  version: 1,
  assetTypes: [
    {
      key: 't1',
      name: 'Notebook',
      codePrefix: 'NB',
      customFieldsSchema: [{ key: 'condition', label: 'Stav', type: 'select', options: ['new'] }],
    },
  ],
  locations: [
    { key: 'root', name: 'Budova', parentKey: null },
    { key: 'l1', name: 'Sklad', parentKey: 'root' },
  ],
  assets: [
    {
      code: 'nb-001',
      name: 'Dell',
      typeKey: 't1',
      locationKey: 'l1',
      status: 'retired',
      archivedAt: '2025-01-01T00:00:00.000Z',
      createdAt: '2024-05-01T00:00:00.000Z',
      customFields: { condition: 'new' },
      externalIds: [{ kind: 'serial', value: 'SN-123' }],
    },
    { code: 'nb-002', name: 'HP', typeKey: 't1' },
  ],
  loans: [
    {
      borrowerName: 'Jan Novák',
      purpose: 'Akce',
      loanedAt: '2024-08-01T00:00:00.000Z',
      items: [{ assetCode: 'NB-002', returnedAt: null }],
    },
  ],
  damages: [
    {
      assetCode: 'nb-001',
      occurredAt: '2024-07-01T00:00:00.000Z',
      description: 'Škrábanec',
      severity: 'minor',
    },
  ],
};

describe('import API', () => {
  let server: TestServer;
  let adminCookie: string;

  beforeEach(() => {
    server = setupTestServer();
    adminCookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  it('imports types, hierarchical locations, assets, loans and damages', async () => {
    const res = await postImport(server, adminCookie, sampleBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body).toMatchObject({ types: 1, locations: 2, assets: 2, loans: 1, damages: 1 });

    // Codes are uppercased so the app can find them.
    const a1 = server.db.select().from(assets).where(eq(assets.code, 'NB-001')).get()!;
    expect(a1.status).toBe('retired');
    expect(a1.archivedAt).toBeTruthy();
    expect(a1.createdAt.getTime()).toBe(new Date('2024-05-01T00:00:00.000Z').getTime());
    expect((a1.customFields as { condition?: string }).condition).toBe('new');

    // Location hierarchy is wired by parentKey.
    const sklad = server.db.select().from(locations).where(eq(locations.name, 'Sklad')).get()!;
    const budova = server.db.select().from(locations).where(eq(locations.name, 'Budova')).get()!;
    expect(sklad.parentId).toBe(budova.id);

    // Loan item resolved despite lower-case assetCode in input.
    const loanRows = server.db.select().from(loans).all();
    expect(loanRows).toHaveLength(1);
    expect(server.db.select().from(loanItems).all()).toHaveLength(1);

    expect(server.db.select().from(damageReports).all()).toHaveLength(1);
  });

  it('is idempotent — a second run skips existing assets', async () => {
    await postImport(server, adminCookie, sampleBody);
    const res = await postImport(server, adminCookie, sampleBody);
    const body = (await res.json()) as Record<string, number>;
    expect(body.assets).toBe(0);
    expect(body.skippedAssets).toBe(2);
    expect(server.db.select().from(assets).all()).toHaveLength(2);
  });

  it('reuses an existing type by code prefix instead of duplicating', async () => {
    const res = await postImport(server, adminCookie, {
      version: 1,
      assetTypes: [{ key: 'x', name: 'Whatever', codePrefix: 'LAP' }],
      assets: [{ code: 'LAP-9001', name: 'Reuse', typeKey: 'x' }],
    });
    expect(res.status).toBe(200);
    // The test server already seeds a 'LAP' type; no new type row created.
    expect(
      server.db.select().from(assetTypes).where(eq(assetTypes.codePrefix, 'LAP')).all(),
    ).toHaveLength(1);
    const asset = server.db.select().from(assets).where(eq(assets.code, 'LAP-9001')).get()!;
    expect(asset.typeId).toBe(server.laptopTypeId);
  });

  it('rejects non-admin callers', async () => {
    const memberCookie = server.loginAs(server.createUser({ role: 'member' }));
    const res = await postImport(server, memberCookie, { version: 1, assets: [] });
    expect(res.status).toBe(403);
  });

  it('dryRun validates and counts but writes nothing', async () => {
    const res = await server.authRequest('/api/import?dryRun=true', {
      cookie: adminCookie,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleBody),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.dryRun).toBe(true);
    expect(body.assets).toBe(2);
    expect(body.loans).toBe(1);
    // Nothing persisted.
    expect(server.db.select().from(assets).all()).toHaveLength(0);
    expect(server.db.select().from(loans).all()).toHaveLength(0);
  });

  it('stores already-uploaded photoPaths directly on the asset', async () => {
    const res = await postImport(server, adminCookie, {
      version: 1,
      assets: [{ code: 'PIC-1', name: 'WithPhoto', photoPaths: ['2024/01/abc.jpg'] }],
    });
    expect(res.status).toBe(200);
    const asset = server.db.select().from(assets).where(eq(assets.code, 'PIC-1')).get()!;
    expect(asset.photoPaths).toEqual(['2024/01/abc.jpg']);
  });

  it('reports dangling references instead of silently dropping rows', async () => {
    const res = await server.authRequest('/api/import?dryRun=true', {
      cookie: adminCookie,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        assets: [{ code: 'A-1', name: 'A', typeKey: 'ghost-type', locationKey: 'ghost-loc' }],
        loans: [
          { borrowerName: 'Eva', items: [{ assetCode: 'A-1' }, { assetCode: 'DOES-NOT-EXIST' }] },
        ],
        damages: [
          {
            assetCode: 'NOPE',
            occurredAt: '2024-01-01T00:00:00Z',
            description: 'x',
            severity: 'minor',
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unresolvedReferences: { kind: string; value: string }[] };
    const refs = body.unresolvedReferences;
    expect(refs).toContainEqual(expect.objectContaining({ kind: 'type', value: 'ghost-type' }));
    expect(refs).toContainEqual(expect.objectContaining({ kind: 'location', value: 'ghost-loc' }));
    expect(refs).toContainEqual(
      expect.objectContaining({ kind: 'asset', value: 'DOES-NOT-EXIST' }),
    );
    expect(refs).toContainEqual(expect.objectContaining({ kind: 'asset', value: 'NOPE' }));
    // A-1 resolves (it's in the payload), so it must NOT be flagged.
    expect(refs.find((r) => r.value === 'A-1')).toBeUndefined();
  });

  it('round-trips through the full JSON export into a fresh instance', async () => {
    await postImport(server, adminCookie, sampleBody);

    const exportRes = await server.authRequest('/api/export/full.json', {
      cookie: adminCookie,
      method: 'GET',
    });
    expect(exportRes.status).toBe(200);
    const dump = await exportRes.json();

    const fresh = setupTestServer();
    try {
      const freshAdmin = fresh.loginAs(fresh.createUser({ role: 'admin' }));
      const importRes = await postImport(fresh, freshAdmin, dump);
      expect(importRes.status).toBe(200);

      // Same assets land in the fresh instance, with status/code preserved.
      const codes = fresh.db
        .select({ code: assets.code })
        .from(assets)
        .all()
        .map((r) => r.code)
        .sort();
      expect(codes).toEqual(['NB-001', 'NB-002']);
      const a1 = fresh.db.select().from(assets).where(eq(assets.code, 'NB-001')).get()!;
      expect(a1.status).toBe('retired');
      expect(fresh.db.select().from(loanItems).all()).toHaveLength(1);
      expect(fresh.db.select().from(damageReports).all()).toHaveLength(1);
    } finally {
      fresh.close();
    }
  });
});
