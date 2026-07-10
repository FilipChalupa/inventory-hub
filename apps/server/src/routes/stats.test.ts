import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { assets, assetTypes, loanItems, loans, locations } from '../db/schema.js';
import { setupTestServer, type TestServer } from '../lib/test-server.js';
import type { StatsResponse } from './stats.js';
import type { UserRow } from '../db/schema.js';

type AssetStatus =
  | 'in_stock'
  | 'assigned'
  | 'on_loan'
  | 'in_repair'
  | 'damaged'
  | 'sold'
  | 'lost'
  | 'retired';

describe('stats API', () => {
  let server: TestServer;
  let cookie: string;
  let admin: UserRow;

  beforeEach(() => {
    server = setupTestServer();
    admin = server.createUser({ role: 'admin' });
    cookie = server.loginAs(admin);
  });

  afterEach(() => {
    server.close();
  });

  let assetSeq = 0;
  function addAsset(input: {
    status?: AssetStatus;
    typeId?: string | null;
    locationId?: string | null;
    archived?: boolean;
  }): string {
    assetSeq += 1;
    const id = crypto.randomUUID();
    server.db
      .insert(assets)
      .values({
        id,
        code: `A-${assetSeq}`,
        name: `Asset ${assetSeq}`,
        status: input.status ?? 'in_stock',
        typeId: input.typeId ?? null,
        locationId: input.locationId ?? null,
        archivedAt: input.archived ? new Date() : null,
      })
      .run();
    return id;
  }

  function addLocation(name: string): string {
    const id = crypto.randomUUID();
    server.db.insert(locations).values({ id, name }).run();
    return id;
  }

  function addLoan(input: {
    startedAt: Date | null;
    expectedReturnAt?: Date | null;
    assetIds: string[];
    returnedAssetIds?: string[];
  }): string {
    const loanId = crypto.randomUUID();
    server.db
      .insert(loans)
      .values({
        id: loanId,
        borrowerName: 'Borrower',
        createdByUserId: admin.id,
        startedAt: input.startedAt,
        expectedReturnAt: input.expectedReturnAt ?? null,
      })
      .run();
    const returned = new Set(input.returnedAssetIds ?? []);
    for (const assetId of input.assetIds) {
      server.db
        .insert(loanItems)
        .values({
          id: crypto.randomUUID(),
          loanId,
          assetId,
          returnedAt: returned.has(assetId) ? new Date() : null,
        })
        .run();
    }
    return loanId;
  }

  async function getStats(): Promise<StatsResponse> {
    const res = await server.authRequest('/api/stats', { cookie });
    expect(res.status).toBe(200);
    return (await res.json()) as StatsResponse;
  }

  it('requires authentication', async () => {
    const res = await server.app.request('/api/stats');
    expect(res.status).toBe(401);
  });

  it('is readable by an auditor (read-only role)', async () => {
    const auditorCookie = server.loginAs(
      server.createUser({ role: 'auditor', email: 'auditor@example.com' }),
    );
    const res = await server.authRequest('/api/stats', { cookie: auditorCookie });
    expect(res.status).toBe(200);
  });

  it('counts only non-archived assets in totalActive and byStatus', async () => {
    addAsset({ status: 'in_stock' });
    addAsset({ status: 'in_stock' });
    addAsset({ status: 'in_repair' });
    addAsset({ status: 'in_repair', archived: true }); // excluded

    const stats = await getStats();
    expect(stats.totalActive).toBe(3);
    expect(stats.inRepair).toBe(1);

    // Every status is present, even with a zero count.
    expect(stats.byStatus).toHaveLength(8);
    const byStatus = Object.fromEntries(stats.byStatus.map((s) => [s.status, s.count]));
    expect(byStatus.in_stock).toBe(2);
    expect(byStatus.in_repair).toBe(1);
    expect(byStatus.on_loan).toBe(0);
    expect(byStatus.retired).toBe(0);
  });

  it('groups by type, bucketing typeless assets under "—"', async () => {
    const phoneType = crypto.randomUUID();
    server.db.insert(assetTypes).values({ id: phoneType, name: 'Phone', codePrefix: 'PHN' }).run();

    addAsset({ typeId: server.laptopTypeId });
    addAsset({ typeId: server.laptopTypeId });
    addAsset({ typeId: phoneType });
    addAsset({ typeId: null });
    addAsset({ typeId: server.laptopTypeId, archived: true }); // excluded

    const stats = await getStats();
    const byType = Object.fromEntries(stats.byType.map((t) => [t.typeName, t.count]));
    expect(byType.Laptop).toBe(2);
    expect(byType.Phone).toBe(1);
    expect(byType['—']).toBe(1);
    // Sorted by count descending — Laptop first.
    expect(stats.byType[0]!.typeName).toBe('Laptop');
  });

  it('returns top locations by count and omits assets with no location', async () => {
    const office = addLocation('Office');
    const warehouse = addLocation('Warehouse');
    addAsset({ locationId: office });
    addAsset({ locationId: office });
    addAsset({ locationId: office });
    addAsset({ locationId: warehouse });
    addAsset({ locationId: null }); // omitted
    addAsset({ locationId: office, archived: true }); // excluded

    const stats = await getStats();
    expect(stats.byLocation).toHaveLength(2);
    expect(stats.byLocation[0]).toMatchObject({ locationName: 'Office', count: 3 });
    expect(stats.byLocation[1]).toMatchObject({ locationName: 'Warehouse', count: 1 });
    expect(stats.byLocation.some((l) => l.locationName === '—')).toBe(false);
  });

  it('classifies loans into active, overdue and planned', async () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);

    const a1 = addAsset({ status: 'on_loan' });
    const a2 = addAsset({ status: 'on_loan' });
    const a3 = addAsset({ status: 'on_loan' });
    const a4 = addAsset({ status: 'in_stock' });
    const a5 = addAsset({ status: 'on_loan' });

    // active, not overdue
    addLoan({ startedAt: past, expectedReturnAt: future, assetIds: [a1] });
    // active + overdue
    addLoan({ startedAt: past, expectedReturnAt: past, assetIds: [a2] });
    // active, no due date
    addLoan({ startedAt: past, expectedReturnAt: null, assetIds: [a3] });
    // planned (not started)
    addLoan({ startedAt: null, expectedReturnAt: future, assetIds: [a4] });
    // fully returned — not counted anywhere
    addLoan({ startedAt: past, expectedReturnAt: past, assetIds: [a5], returnedAssetIds: [a5] });

    const stats = await getStats();
    expect(stats.loans.active).toBe(3);
    expect(stats.loans.overdue).toBe(1);
    expect(stats.loans.planned).toBe(1);
  });

  it('returns zeroed aggregates for an empty inventory', async () => {
    const stats = await getStats();
    expect(stats.totalActive).toBe(0);
    expect(stats.inRepair).toBe(0);
    expect(stats.byType).toEqual([]);
    expect(stats.byLocation).toEqual([]);
    expect(stats.loans).toEqual({ active: 0, overdue: 0, planned: 0 });
    expect(stats.byStatus.every((s) => s.count === 0)).toBe(true);
  });
});
