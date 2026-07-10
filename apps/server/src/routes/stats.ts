import { Hono } from 'hono';
import { desc, eq, isNull, sql } from 'drizzle-orm';
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

export type StatsResponse = {
  totalActive: number;
  byStatus: { status: string; count: number }[];
  byType: { typeId: string | null; typeName: string; count: number }[];
  byLocation: { locationId: string; locationName: string; count: number }[];
  loans: { active: number; overdue: number; planned: number };
  inRepair: number;
};

/**
 * Read-only inventory analytics for the dashboard. Any authenticated role may
 * read it (auditor/member included), so no role restriction beyond auth.
 * Every figure is computed with a single grouped/aggregated query — no N+1.
 */
export const statsRoutes = new Hono<AppContext>().get('/', requireAuth(), (c) => {
  const db = c.get('db');
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

  const body: StatsResponse = {
    totalActive,
    byStatus,
    byType,
    byLocation,
    loans: { active, overdue, planned },
    inRepair,
  };
  return c.json(body);
});
