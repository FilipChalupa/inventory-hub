import { Hono } from 'hono';
import { and, desc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { nextServiceDue } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { assets, assetTypes, loanItems, loans, locations } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

// All asset statuses, in a stable display order — mirrors the enum on the
// `assets.status` column. Kept explicit so `byStatus` always returns every
// status (with a 0 count when none match), not just the ones present in data.
const ASSET_STATUSES = [
  'in_stock',
  'assigned',
  'on_loan',
  'in_repair',
  'damaged',
  'sold',
  'lost',
  'retired',
] as const;

const NO_TYPE_LABEL = '—';
const TOP_LOCATIONS = 8;
/** How far ahead warranty expiry / scheduled service is flagged as "due soon". */
const SOON_WINDOW_DAYS = 30;

export type StatsResponse = {
  totalActive: number;
  byStatus: { status: string; count: number }[];
  byType: { typeId: string | null; typeName: string; count: number }[];
  byLocation: { locationId: string; locationName: string; count: number }[];
  loans: { active: number; overdue: number; planned: number };
  inRepair: number;
  totalValue: number;
  valueByType: { typeId: string; typeName: string; value: number }[];
  warrantyExpiringSoon: number;
  serviceDueSoon: number;
  currency: string;
};

/**
 * Read-only inventory analytics for the dashboard. Any authenticated role may
 * read it (auditor/member included), so no role restriction beyond auth.
 * Every figure is computed with a single grouped/aggregated query — no N+1.
 */
export const statsRoutes = new Hono<AppContext>().get('/', requireAuth(), (c) => {
  const db = c.get('db');
  const env = c.get('env');
  const now = Date.now();

  // Non-archived assets grouped by status. Seeded with every known status so
  // the shape is stable (counts default to 0).
  const statusRows = db
    .select({ status: assets.status, count: sql<number>`count(*)` })
    .from(assets)
    .where(isNull(assets.archivedAt))
    .groupBy(assets.status)
    .all();
  const statusCounts = new Map(statusRows.map((r) => [r.status, r.count] as const));
  const byStatus = ASSET_STATUSES.map((status) => ({
    status,
    count: statusCounts.get(status) ?? 0,
  }));

  const totalActive = byStatus.reduce((sum, s) => sum + s.count, 0);
  const inRepair = statusCounts.get('in_repair') ?? 0;

  // Non-archived assets grouped by type (assets with no type collapse into a
  // single "—" bucket).
  const typeRows = db
    .select({
      typeId: assets.typeId,
      typeName: assetTypes.name,
      count: sql<number>`count(*)`,
    })
    .from(assets)
    .leftJoin(assetTypes, eq(assets.typeId, assetTypes.id))
    .where(isNull(assets.archivedAt))
    .groupBy(assets.typeId)
    .all();
  const byType = typeRows
    .map((r) => ({
      typeId: r.typeId,
      typeName: r.typeName ?? NO_TYPE_LABEL,
      count: r.count,
    }))
    .sort((a, b) => b.count - a.count);

  // Top locations by non-archived asset count. Assets with no location are
  // excluded (there's nothing to link to).
  const locationRows = db
    .select({
      locationId: assets.locationId,
      locationName: locations.name,
      count: sql<number>`count(*)`,
    })
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .where(isNull(assets.archivedAt))
    .groupBy(assets.locationId)
    .orderBy(desc(sql`count(*)`))
    .limit(TOP_LOCATIONS)
    .all();
  const byLocation = locationRows.map((r) => ({
    locationId: r.locationId as string,
    locationName: r.locationName,
    count: r.count,
  }));

  // Loan lifecycle. One grouped pass over loans + their items: a loan is
  // "open" while it has at least one not-yet-returned item.
  //  - active:  started, still open
  //  - overdue: started, still open, past its expected return date
  //  - planned: not yet started (reserved), still open
  const loanRows = db
    .select({
      startedAt: loans.startedAt,
      expectedReturnAt: loans.expectedReturnAt,
      openItems: sql<number>`count(case when ${loanItems.returnedAt} is null then 1 end)`,
    })
    .from(loans)
    .leftJoin(loanItems, eq(loanItems.loanId, loans.id))
    .groupBy(loans.id)
    .all();

  let active = 0;
  let overdue = 0;
  let planned = 0;
  for (const loan of loanRows) {
    if (loan.openItems === 0) continue; // fully returned — not a live loan
    if (loan.startedAt === null) {
      planned += 1;
      continue;
    }
    active += 1;
    const due = loan.expectedReturnAt;
    if (due !== null && due.getTime() < now) overdue += 1;
  }

  const soon = new Date(now + SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Total capital tied up in the active fleet — sum of purchase prices (minor
  // units) over non-archived assets. COALESCE keeps it 0 for an empty inventory.
  const totalValueRow = db
    .select({ total: sql<number>`coalesce(sum(${assets.purchasePrice}), 0)` })
    .from(assets)
    .where(isNull(assets.archivedAt))
    .get();
  const totalValue = totalValueRow?.total ?? 0;

  // Value grouped by type (minor units), typeless assets excluded (nothing to
  // attribute the value to). Only types with a non-zero total are surfaced.
  const valueTypeRows = db
    .select({
      typeId: assets.typeId,
      typeName: assetTypes.name,
      value: sql<number>`coalesce(sum(${assets.purchasePrice}), 0)`,
    })
    .from(assets)
    .innerJoin(assetTypes, eq(assets.typeId, assetTypes.id))
    .where(isNull(assets.archivedAt))
    .groupBy(assets.typeId)
    .all();
  const valueByType = valueTypeRows
    .filter((r) => r.value > 0)
    .map((r) => ({ typeId: r.typeId as string, typeName: r.typeName, value: r.value }))
    .sort((a, b) => b.value - a.value);

  // Non-archived assets whose warranty has expired or lapses within the window.
  const warrantyRow = db
    .select({ count: sql<number>`count(*)` })
    .from(assets)
    .where(
      and(
        isNull(assets.archivedAt),
        isNotNull(assets.warrantyUntil),
        lte(assets.warrantyUntil, soon),
      ),
    )
    .get();
  const warrantyExpiringSoon = warrantyRow?.count ?? 0;

  // Scheduled service that is overdue or due within the window. The next-service
  // date depends on lastServicedAt/purchasedAt/createdAt, so compute it in JS
  // over the (bounded) set of assets that actually have a schedule.
  const serviceCandidates = db
    .select({
      serviceIntervalDays: assets.serviceIntervalDays,
      lastServicedAt: assets.lastServicedAt,
      purchasedAt: assets.purchasedAt,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(and(isNull(assets.archivedAt), isNotNull(assets.serviceIntervalDays)))
    .all();
  const serviceDueSoon = serviceCandidates.filter((a) => {
    const due = nextServiceDue(a);
    return due !== null && due <= soon;
  }).length;

  const body: StatsResponse = {
    totalActive,
    byStatus,
    byType,
    byLocation,
    loans: { active, overdue, planned },
    inRepair,
    totalValue,
    valueByType,
    warrantyExpiringSoon,
    serviceDueSoon,
    currency: env.CURRENCY,
  };
  return c.json(body);
});
