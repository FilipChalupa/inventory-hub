import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { currentAssetValue } from '@inventory-hub/shared';
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
    purchasePrice?: number | null;
    warrantyUntil?: Date | null;
    serviceIntervalDays?: number | null;
    lastServicedAt?: Date | null;
    purchasedAt?: Date | null;
    usefulLifeMonths?: number | null;
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
        purchasePrice: input.purchasePrice ?? null,
        warrantyUntil: input.warrantyUntil ?? null,
        serviceIntervalDays: input.serviceIntervalDays ?? null,
        lastServicedAt: input.lastServicedAt ?? null,
        purchasedAt: input.purchasedAt ?? null,
        usefulLifeMonths: input.usefulLifeMonths ?? null,
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

  it('sums total value of non-archived assets and groups value by type', async () => {
    const phoneType = crypto.randomUUID();
    server.db.insert(assetTypes).values({ id: phoneType, name: 'Phone', codePrefix: 'PHN' }).run();

    addAsset({ typeId: server.laptopTypeId, purchasePrice: 100_000 });
    addAsset({ typeId: server.laptopTypeId, purchasePrice: 50_000 });
    addAsset({ typeId: phoneType, purchasePrice: 30_000 });
    addAsset({ typeId: null, purchasePrice: 9_999 }); // counts in total, not in valueByType
    addAsset({ typeId: server.laptopTypeId, purchasePrice: null }); // no price, no effect
    addAsset({ typeId: phoneType, purchasePrice: 1_000_000, archived: true }); // excluded

    const stats = await getStats();
    expect(stats.totalValue).toBe(189_999);
    expect(stats.currency).toBe('CZK');

    const valueByType = stats.valueByType;
    // Sorted descending by value — Laptop (150000) before Phone (30000).
    expect(valueByType.map((r) => [r.typeName, r.value])).toEqual([
      ['Laptop', 150_000],
      ['Phone', 30_000],
    ]);
    // Typeless assets never appear in valueByType.
    expect(valueByType.some((r) => r.typeName === '—')).toBe(false);
  });

  it('sums the depreciated (current) value of non-archived assets', async () => {
    const purchasedAt = new Date();
    purchasedAt.setMonth(purchasedAt.getMonth() - 6);

    // Depreciated over 12 months, 6 elapsed → roughly half the price.
    addAsset({ purchasePrice: 100_000, purchasedAt, usefulLifeMonths: 12 });
    // No useful life → current value stays at the full purchase price.
    addAsset({ purchasePrice: 50_000 });
    // No price → contributes nothing.
    addAsset({ purchasePrice: null, usefulLifeMonths: 12, purchasedAt });
    // Archived → excluded.
    addAsset({ purchasePrice: 999_999, archived: true });

    const depreciated = currentAssetValue({
      purchasePrice: 100_000,
      purchasedAt,
      usefulLifeMonths: 12,
    })!;

    const stats = await getStats();
    expect(stats.totalValue).toBe(150_000);
    expect(stats.totalCurrentValue).toBe(depreciated + 50_000);
    expect(stats.totalCurrentValue).toBeLessThan(stats.totalValue);
  });

  it('counts warranties that are expired or expiring within 30 days', async () => {
    const day = 86_400_000;
    addAsset({ warrantyUntil: new Date(Date.now() - 5 * day) }); // expired
    addAsset({ warrantyUntil: new Date(Date.now() + 10 * day) }); // soon
    addAsset({ warrantyUntil: new Date(Date.now() + 200 * day) }); // far off
    addAsset({ warrantyUntil: null }); // none
    addAsset({ warrantyUntil: new Date(Date.now() + 5 * day), archived: true }); // excluded

    const stats = await getStats();
    expect(stats.warrantyExpiringSoon).toBe(2);
  });

  it('counts scheduled service that is overdue or due within 30 days', async () => {
    const day = 86_400_000;
    // Serviced 100 days ago, interval 90 → next service was 10 days ago (overdue).
    addAsset({ serviceIntervalDays: 90, lastServicedAt: new Date(Date.now() - 100 * day) });
    // Serviced 70 days ago, interval 90 → due in 20 days (soon).
    addAsset({ serviceIntervalDays: 90, lastServicedAt: new Date(Date.now() - 70 * day) });
    // Serviced 10 days ago, interval 365 → due far off.
    addAsset({ serviceIntervalDays: 365, lastServicedAt: new Date(Date.now() - 10 * day) });
    // No schedule.
    addAsset({ serviceIntervalDays: null });
    // Overdue but archived — excluded.
    addAsset({
      serviceIntervalDays: 30,
      lastServicedAt: new Date(Date.now() - 100 * day),
      archived: true,
    });

    const stats = await getStats();
    expect(stats.serviceDueSoon).toBe(2);
  });

  it('returns zeroed aggregates for an empty inventory', async () => {
    const stats = await getStats();
    expect(stats.totalActive).toBe(0);
    expect(stats.inRepair).toBe(0);
    expect(stats.byType).toEqual([]);
    expect(stats.byLocation).toEqual([]);
    expect(stats.loans).toEqual({ active: 0, overdue: 0, planned: 0 });
    expect(stats.byStatus.every((s) => s.count === 0)).toBe(true);
    expect(stats.totalValue).toBe(0);
    expect(stats.totalCurrentValue).toBe(0);
    expect(stats.valueByType).toEqual([]);
    expect(stats.warrantyExpiringSoon).toBe(0);
    expect(stats.serviceDueSoon).toBe(0);
    expect(stats.currency).toBe('CZK');
  });
});
