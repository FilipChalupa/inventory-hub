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
});
