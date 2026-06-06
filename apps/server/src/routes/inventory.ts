import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  createInventorySessionInput,
  markMissingLostInput,
  scanInventoryInput,
  type ScanResultKind,
} from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import type { Db } from '../db/client.js';
import {
  assetEvents,
  assets,
  inventoryScans,
  inventorySessions,
  locations,
  type AssetRow,
} from '../db/schema.js';

/**
 * Inventory writes (create / scan / close / resolve) are stocktaking
 * operations done by warehouse staff; restrict them to admin + operator.
 * Reading the report stays open to any authenticated role (auditors included).
 */
function canWrite(role: string): boolean {
  return role === 'admin' || role === 'operator';
}

/**
 * Resolves a location id to the set of itself plus all descendant location
 * ids, so a scope can cover a whole building / room subtree. Cycle-guarded
 * via a visited set.
 */
function locationSubtreeIds(db: Db, rootId: string): Set<string> {
  const rows = db.select({ id: locations.id, parentId: locations.parentId }).from(locations).all();
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const arr = childrenOf.get(r.parentId) ?? [];
    arr.push(r.id);
    childrenOf.set(r.parentId, arr);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const child of childrenOf.get(cur) ?? []) stack.push(child);
  }
  return out;
}

/**
 * Computes the expected set of assets for a session's scope: every
 * non-archived asset, optionally narrowed to a location subtree.
 */
function expectedAssets(db: Db, locationId: string | null): AssetRow[] {
  const all = db.select().from(assets).where(isNull(assets.archivedAt)).all();
  if (!locationId) return all;
  const scope = locationSubtreeIds(db, locationId);
  return all.filter((a) => a.locationId !== null && scope.has(a.locationId));
}

type ReportAsset = {
  id: string;
  code: string;
  name: string;
  status: AssetRow['status'];
  locationId: string | null;
  scannedAt: Date | null;
};

/**
 * Reconciles the expected set against what was actually scanned:
 *  - found:      expected ∩ scanned
 *  - missing:    expected − scanned (status surfaced so on-loan items are explainable)
 *  - unexpected: scanned − expected (archived or scanned outside the scope)
 */
function buildReport(db: Db, sessionId: string, locationId: string | null) {
  const expected = expectedAssets(db, locationId);
  const expectedById = new Map(expected.map((a) => [a.id, a]));

  const scans = db
    .select({ assetId: inventoryScans.assetId, scannedAt: inventoryScans.scannedAt })
    .from(inventoryScans)
    .where(eq(inventoryScans.sessionId, sessionId))
    .all();
  const scannedAtById = new Map(scans.map((s) => [s.assetId, s.scannedAt]));

  const found: ReportAsset[] = [];
  const missing: ReportAsset[] = [];
  for (const a of expected) {
    const scannedAt = scannedAtById.get(a.id) ?? null;
    const entry: ReportAsset = {
      id: a.id,
      code: a.code,
      name: a.name,
      status: a.status,
      locationId: a.locationId,
      scannedAt,
    };
    if (scannedAt) found.push(entry);
    else missing.push(entry);
  }

  // Scans whose asset is not in the expected set (archived or out of scope).
  const unexpectedIds = scans.map((s) => s.assetId).filter((id) => !expectedById.has(id));
  const unexpected: ReportAsset[] =
    unexpectedIds.length === 0
      ? []
      : db
          .select()
          .from(assets)
          .where(inArray(assets.id, unexpectedIds))
          .all()
          .map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            status: a.status,
            locationId: a.locationId,
            scannedAt: scannedAtById.get(a.id) ?? null,
          }));

  const sortByCode = (a: ReportAsset, b: ReportAsset) => a.code.localeCompare(b.code);
  found.sort(sortByCode);
  missing.sort(sortByCode);
  unexpected.sort(sortByCode);

  return {
    counts: {
      expected: expected.length,
      found: found.length,
      missing: missing.length,
      unexpected: unexpected.length,
    },
    found,
    missing,
    unexpected,
  };
}

export const inventoryRoutes = new Hono<AppContext>()
  .get('/', (c) => {
    const db = c.get('db');
    const rows = db
      .select()
      .from(inventorySessions)
      .orderBy(desc(inventorySessions.createdAt))
      .limit(200)
      .all();
    // Cheap per-session scan tally for the list view.
    const items = rows.map((s) => {
      const scanCount = db
        .select({ id: inventoryScans.id })
        .from(inventoryScans)
        .where(eq(inventoryScans.sessionId, s.id))
        .all().length;
      return { ...s, scanCount };
    });
    return c.json({ items });
  })
  .post('/', zValidator('json', createInventorySessionInput), (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    if (!canWrite(user.role)) {
      return c.json({ error: { message: 'Pouze admin nebo operator může spustit inventuru' } }, 403);
    }
    const input = c.req.valid('json');

    if (input.locationId) {
      const loc = db
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.id, input.locationId))
        .get();
      if (!loc) return c.json({ error: { message: 'Lokace nenalezena' } }, 400);
    }

    const name =
      input.name?.trim() ||
      `Inventura ${new Date().toLocaleDateString('cs-CZ', { dateStyle: 'medium' })}`;
    const id = crypto.randomUUID();
    db.insert(inventorySessions)
      .values({
        id,
        name,
        locationId: input.locationId ?? null,
        note: input.note ?? null,
        startedByUserId: user.id,
      })
      .run();
    const session = db
      .select()
      .from(inventorySessions)
      .where(eq(inventorySessions.id, id))
      .get()!;
    return c.json({ session }, 201);
  })
  .get('/:id', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const session = db
      .select()
      .from(inventorySessions)
      .where(eq(inventorySessions.id, id))
      .get();
    if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);
    const report = buildReport(db, session.id, session.locationId);
    return c.json({ session, report });
  })
  .post('/:id/scan', zValidator('json', scanInventoryInput), (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    if (!canWrite(user.role)) {
      return c.json({ error: { message: 'Pouze admin nebo operator může skenovat' } }, 403);
    }
    const id = c.req.param('id');
    const code = c.req.valid('json').code.toUpperCase();

    const session = db
      .select()
      .from(inventorySessions)
      .where(eq(inventorySessions.id, id))
      .get();
    if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);
    if (session.status !== 'open') {
      return c.json({ error: { message: 'Inventura je už uzavřená' } }, 409);
    }

    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) return c.json({ error: { message: `Asset ${code} nenalezen` } }, 404);

    const already = db
      .select({ id: inventoryScans.id })
      .from(inventoryScans)
      .where(and(eq(inventoryScans.sessionId, id), eq(inventoryScans.assetId, asset.id)))
      .get();

    // Whether the asset belongs to this session's expected set.
    const inScope =
      asset.archivedAt === null &&
      (session.locationId === null ||
        (asset.locationId !== null &&
          locationSubtreeIds(db, session.locationId).has(asset.locationId)));

    const result: ScanResultKind = already ? 'already' : inScope ? 'found' : 'unexpected';

    if (!already) {
      const now = new Date();
      db.insert(inventoryScans)
        .values({ sessionId: id, assetId: asset.id, scannedByUserId: user.id, scannedAt: now })
        .run();
      db.update(assets).set({ lastSeenAt: now }).where(eq(assets.id, asset.id)).run();
      db.insert(assetEvents)
        .values({
          assetId: asset.id,
          actorUserId: user.id,
          type: 'inventory_seen',
          payload: { sessionId: id, inScope },
        })
        .run();
    }

    return c.json({
      result,
      asset: {
        id: asset.id,
        code: asset.code,
        name: asset.name,
        status: asset.status,
        locationId: asset.locationId,
      },
    });
  })
  .post('/:id/close', (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    if (!canWrite(user.role)) {
      return c.json({ error: { message: 'Pouze admin nebo operator může uzavřít inventuru' } }, 403);
    }
    const id = c.req.param('id');
    const session = db
      .select()
      .from(inventorySessions)
      .where(eq(inventorySessions.id, id))
      .get();
    if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);
    if (session.status === 'closed') {
      return c.json({ error: { message: 'Inventura je už uzavřená' } }, 409);
    }
    db.update(inventorySessions)
      .set({ status: 'closed', closedAt: new Date(), closedByUserId: user.id, updatedAt: new Date() })
      .where(eq(inventorySessions.id, id))
      .run();
    return c.json({ ok: true });
  })
  .post('/:id/reopen', (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    if (!canWrite(user.role)) {
      return c.json({ error: { message: 'Pouze admin nebo operator může znovu otevřít inventuru' } }, 403);
    }
    const id = c.req.param('id');
    const session = db
      .select()
      .from(inventorySessions)
      .where(eq(inventorySessions.id, id))
      .get();
    if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);
    if (session.status === 'open') {
      return c.json({ error: { message: 'Inventura je už otevřená' } }, 409);
    }
    db.update(inventorySessions)
      .set({ status: 'open', closedAt: null, closedByUserId: null, updatedAt: new Date() })
      .where(eq(inventorySessions.id, id))
      .run();
    return c.json({ ok: true });
  })
  .post('/:id/mark-lost', zValidator('json', markMissingLostInput), (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    if (!canWrite(user.role)) {
      return c.json({ error: { message: 'Pouze admin nebo operator může vyřadit assety' } }, 403);
    }
    const id = c.req.param('id');
    const session = db
      .select()
      .from(inventorySessions)
      .where(eq(inventorySessions.id, id))
      .get();
    if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);

    const codes = c.req.valid('json').codes.map((x) => x.toUpperCase());
    const now = new Date();
    let archived = 0;
    db.transaction((tx) => {
      for (const code of codes) {
        const asset = tx.select().from(assets).where(eq(assets.code, code)).get();
        if (!asset || asset.archivedAt) continue;
        tx.update(assets)
          .set({ status: 'lost', archivedAt: now, updatedAt: now })
          .where(eq(assets.id, asset.id))
          .run();
        tx.insert(assetEvents)
          .values({
            assetId: asset.id,
            actorUserId: user.id,
            type: 'archived',
            payload: { status: 'lost', reason: 'inventory', sessionId: id },
          })
          .run();
        archived += 1;
      }
    });
    return c.json({ ok: true, archived });
  });
