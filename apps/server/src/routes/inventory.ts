import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  createInventorySessionInput,
  inventoryItemNoteInput,
  markMissingLostInput,
  scanInventoryInput,
  updateInventorySessionInput,
  type ScanResultKind,
} from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import type { Db } from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';
import { lookupAssetsByIdentifier } from '../lib/asset-lookup.js';
import {
  assetEvents,
  assets,
  inventoryItemNotes,
  inventoryScans,
  inventorySessions,
  locations,
  users,
  type AssetRow,
  type InventorySessionRow,
} from '../db/schema.js';
import { toCsv } from '../lib/csv.js';
import { emailCopy } from '../lib/email-copy.js';
import { emitWebhook } from '../lib/webhooks.js';

// Inventory writes (create / scan / close / reopen / notes / mark-lost) are
// stocktaking operations done by warehouse staff; restrict them to
// admin + operator via `requireAuth('admin', 'operator')` on each mutating
// route. Reading the report stays open to any authenticated role (auditors
// included).

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
 * SQL condition (on `assets`) for a session's expected set. A hand-picked
 * asset list wins outright; otherwise every non-archived asset narrowed by
 * `locationId` (its subtree) and `typeIds`, each applied only when present.
 * Evaluated in SQLite so a report never has to load the whole inventory.
 */
function scopeCondition(db: Db, session: InventorySessionRow): SQL {
  const conds: SQL[] = [isNull(assets.archivedAt)];
  if (session.assetIds && session.assetIds.length > 0) {
    conds.push(inArray(assets.id, session.assetIds));
  } else {
    if (session.locationId) {
      conds.push(inArray(assets.locationId, [...locationSubtreeIds(db, session.locationId)]));
    }
    if (session.typeIds && session.typeIds.length > 0) {
      conds.push(inArray(assets.typeId, session.typeIds));
    }
  }
  return and(...conds)!;
}

/** A session as sent to clients — without the (possibly large) snapshot. */
function publicSession(s: InventorySessionRow) {
  const { expectedSnapshot: _snapshot, ...rest } = s;
  return rest;
}

/** Just the columns a report row needs (not notes, custom fields, …). */
const REPORT_COLUMNS = {
  id: assets.id,
  code: assets.code,
  name: assets.name,
  status: assets.status,
  locationId: assets.locationId,
};

function expectedAssets(db: Db, session: InventorySessionRow) {
  // Closed with a snapshot: exactly what was expected then (archived since or
  // not), so the record doesn't drift.
  if (session.status === 'closed' && session.expectedSnapshot) {
    if (session.expectedSnapshot.length === 0) return [];
    return db
      .select(REPORT_COLUMNS)
      .from(assets)
      .where(inArray(assets.id, session.expectedSnapshot))
      .all();
  }
  return db.select(REPORT_COLUMNS).from(assets).where(scopeCondition(db, session)).all();
}

/** Report counts via a few COUNT queries — what a scan response carries. */
function reportCounts(db: Db, session: InventorySessionRow) {
  const scope = scopeCondition(db, session);
  const expected =
    db
      .select({ n: sql<number>`count(*)` })
      .from(assets)
      .where(scope)
      .get()?.n ?? 0;
  const found =
    db
      .select({ n: sql<number>`count(*)` })
      .from(inventoryScans)
      .innerJoin(assets, eq(assets.id, inventoryScans.assetId))
      .where(and(eq(inventoryScans.sessionId, session.id), scope))
      .get()?.n ?? 0;
  const scanned =
    db
      .select({ n: sql<number>`count(*)` })
      .from(inventoryScans)
      .where(eq(inventoryScans.sessionId, session.id))
      .get()?.n ?? 0;
  return { expected, found, missing: expected - found, unexpected: scanned - found };
}

/** Whether a single scanned asset belongs to the session's expected scope. */
function isInScope(db: Db, session: InventorySessionRow, asset: AssetRow): boolean {
  if (asset.archivedAt !== null) return false;
  if (session.assetIds && session.assetIds.length > 0) {
    return session.assetIds.includes(asset.id);
  }
  if (session.locationId) {
    if (asset.locationId === null) return false;
    if (!locationSubtreeIds(db, session.locationId).has(asset.locationId)) return false;
  }
  if (session.typeIds && session.typeIds.length > 0) {
    if (asset.typeId === null || !session.typeIds.includes(asset.typeId)) return false;
  }
  return true;
}

type ReportAsset = {
  id: string;
  code: string;
  name: string;
  status: AssetRow['status'];
  locationId: string | null;
  scannedAt: Date | null;
  note: string | null;
};

/**
 * Reconciles the expected set against what was actually scanned:
 *  - found:      expected ∩ scanned
 *  - missing:    expected − scanned (status surfaced so on-loan items are explainable)
 *  - unexpected: scanned − expected (archived or scanned outside the scope)
 * Each asset carries its per-session note, when one was pinned.
 */
function buildReport(db: Db, session: InventorySessionRow) {
  const sessionId = session.id;
  const expected = expectedAssets(db, session);
  const expectedById = new Map(expected.map((a) => [a.id, a]));

  const scans = db
    .select({ assetId: inventoryScans.assetId, scannedAt: inventoryScans.scannedAt })
    .from(inventoryScans)
    .where(eq(inventoryScans.sessionId, sessionId))
    .all();
  const scannedAtById = new Map(scans.map((s) => [s.assetId, s.scannedAt]));

  const noteRows = db
    .select({ assetId: inventoryItemNotes.assetId, note: inventoryItemNotes.note })
    .from(inventoryItemNotes)
    .where(eq(inventoryItemNotes.sessionId, sessionId))
    .all();
  const noteByAsset = new Map(noteRows.map((n) => [n.assetId, n.note]));

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
      note: noteByAsset.get(a.id) ?? null,
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
          .select(REPORT_COLUMNS)
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
            note: noteByAsset.get(a.id) ?? null,
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
    // Per-session scan tally in one grouped query (was one query loading
    // every scan row per session).
    const counts = new Map(
      rows.length === 0
        ? []
        : db
            .select({ sessionId: inventoryScans.sessionId, n: sql<number>`count(*)` })
            .from(inventoryScans)
            .where(
              inArray(
                inventoryScans.sessionId,
                rows.map((r) => r.id),
              ),
            )
            .groupBy(inventoryScans.sessionId)
            .all()
            .map((r) => [r.sessionId, r.n]),
    );
    const items = rows.map((s) => ({ ...publicSession(s), scanCount: counts.get(s.id) ?? 0 }));
    return c.json({ items });
  })
  .post(
    '/',
    requireAuth('admin', 'operator'),
    zValidator('json', createInventorySessionInput),
    (c) => {
      const db = c.get('db');
      const user = c.get('user')!;
      const input = c.req.valid('json');

      if (input.locationId) {
        const loc = db
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.id, input.locationId))
          .get();
        if (!loc) return c.json({ error: { message: 'Lokace nenalezena' } }, 400);
      }

      const typeIds = input.typeIds && input.typeIds.length > 0 ? input.typeIds : null;
      let assetIds: string[] | null = null;
      if (input.assetCodes && input.assetCodes.length > 0) {
        const codes = [...new Set(input.assetCodes.map((x) => x.toUpperCase()))];
        const found = db
          .select({ id: assets.id })
          .from(assets)
          .where(inArray(assets.code, codes))
          .all();
        if (found.length !== codes.length) {
          return c.json({ error: { message: 'Některé vybrané assety neexistují' } }, 400);
        }
        assetIds = found.map((a) => a.id);
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
          typeIds,
          assetIds,
          note: input.note ?? null,
          startedByUserId: user.id,
        })
        .run();
      const session = db
        .select()
        .from(inventorySessions)
        .where(eq(inventorySessions.id, id))
        .get()!;
      return c.json({ session: publicSession(session) }, 201);
    },
  )
  // What changed since an earlier stock-take: assets newly missing, found
  // again, missing in both (repeat losses), and the scope's churn. `with`
  // picks the earlier session; by default the latest earlier closed session
  // with the same scope, else the latest earlier closed one.
  .get('/:id/compare', (c) => {
    const db = c.get('db');
    const current = db
      .select()
      .from(inventorySessions)
      .where(eq(inventorySessions.id, c.req.param('id')))
      .get();
    if (!current) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);

    const withId = c.req.query('with');
    let base: InventorySessionRow | undefined;
    if (withId) {
      base = db.select().from(inventorySessions).where(eq(inventorySessions.id, withId)).get();
      if (!base || base.id === current.id) {
        return c.json({ error: { message: 'Inventura pro porovnání nenalezena' } }, 404);
      }
    } else {
      const sameScope = (s: InventorySessionRow) =>
        JSON.stringify([s.locationId, s.typeIds ?? [], s.assetIds ?? []]) ===
        JSON.stringify([current.locationId, current.typeIds ?? [], current.assetIds ?? []]);
      const earlier = db
        .select()
        .from(inventorySessions)
        .where(
          and(
            eq(inventorySessions.status, 'closed'),
            lt(inventorySessions.createdAt, current.createdAt),
          ),
        )
        .orderBy(desc(inventorySessions.createdAt))
        .limit(50)
        .all();
      base = earlier.find(sameScope) ?? earlier[0];
    }
    if (!base) return c.json({ base: null });

    const now = buildReport(db, current);
    const before = buildReport(db, base);
    const ids = (list: ReportAsset[]) => new Set(list.map((a) => a.id));
    const brief = (a: ReportAsset) => ({ id: a.id, code: a.code, name: a.name, status: a.status });
    const beforeFound = ids(before.found);
    const beforeMissing = ids(before.missing);
    const nowExpected = ids([...now.found, ...now.missing]);
    const beforeExpected = new Set([...beforeFound, ...beforeMissing]);

    return c.json({
      base: {
        id: base.id,
        name: base.name,
        createdAt: base.createdAt,
        closedAt: base.closedAt,
        sameScope:
          JSON.stringify([base.locationId, base.typeIds ?? [], base.assetIds ?? []]) ===
          JSON.stringify([current.locationId, current.typeIds ?? [], current.assetIds ?? []]),
      },
      newlyMissing: now.missing.filter((a) => beforeFound.has(a.id)).map(brief),
      recovered: now.found.filter((a) => beforeMissing.has(a.id)).map(brief),
      stillMissing: now.missing.filter((a) => beforeMissing.has(a.id)).map(brief),
      addedToScope: [...now.found, ...now.missing]
        .filter((a) => !beforeExpected.has(a.id))
        .map(brief)
        .sort((a, b) => a.code.localeCompare(b.code)),
      removedFromScope: [...before.found, ...before.missing]
        .filter((a) => !nowExpected.has(a.id))
        .map(brief)
        .sort((a, b) => a.code.localeCompare(b.code)),
    });
  })
  // The reconciled report as CSV, one row per asset (found / missing /
  // unexpected) with who scanned it and when — for accounting / archiving.
  .get('/:id/report.csv', (c) => {
    const db = c.get('db');
    const session = db
      .select()
      .from(inventorySessions)
      .where(eq(inventorySessions.id, c.req.param('id')))
      .get();
    if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);
    const report = buildReport(db, session);

    // Full location paths ("Praha / Sklad B") read better than bare names.
    const locs = new Map(
      db
        .select()
        .from(locations)
        .all()
        .map((l) => [l.id, l]),
    );
    const locationPath = (id: string | null): string => {
      const parts: string[] = [];
      for (let cur = id ? locs.get(id) : undefined, guard = 0; cur && guard < 50; guard++) {
        parts.unshift(cur.name);
        cur = cur.parentId ? locs.get(cur.parentId) : undefined;
      }
      return parts.join(' / ');
    };
    const scannedBy = new Map(
      db
        .select({ assetId: inventoryScans.assetId, name: users.name })
        .from(inventoryScans)
        .leftJoin(users, eq(users.id, inventoryScans.scannedByUserId))
        .where(eq(inventoryScans.sessionId, session.id))
        .all()
        .map((r) => [r.assetId, r.name]),
    );
    const rows = (['found', 'missing', 'unexpected'] as const).flatMap((result) =>
      report[result].map((a) => ({
        result,
        code: a.code,
        name: a.name,
        status: a.status,
        location: locationPath(a.locationId),
        scannedAt: a.scannedAt,
        scannedBy: scannedBy.get(a.id) ?? '',
        note: a.note ?? '',
      })),
    );
    const csv = toCsv(rows, [
      { key: 'result', header: 'result' },
      { key: 'code', header: 'code' },
      { key: 'name', header: 'name' },
      { key: 'status', header: 'status' },
      { key: 'location', header: 'location' },
      { key: 'scannedAt', header: 'scanned_at' },
      { key: 'scannedBy', header: 'scanned_by' },
      { key: 'note', header: 'note' },
    ]);
    const slug =
      session.name
        .normalize('NFKD')
        .replace(/[^\w-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'inventura';
    return new Response('\uFEFF' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="inventory-${slug}.csv"`,
      },
    });
  })
  .get('/:id', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const session = db.select().from(inventorySessions).where(eq(inventorySessions.id, id)).get();
    if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);
    const report = buildReport(db, session);
    return c.json({ session: publicSession(session), report });
  })
  .patch(
    '/:id',
    requireAuth('admin', 'operator'),
    zValidator('json', updateInventorySessionInput),
    (c) => {
      const db = c.get('db');
      const id = c.req.param('id');
      const input = c.req.valid('json');
      const session = db.select().from(inventorySessions).where(eq(inventorySessions.id, id)).get();
      if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.note !== undefined) patch.note = input.note;
      db.update(inventorySessions).set(patch).where(eq(inventorySessions.id, id)).run();
      return c.json({ ok: true });
    },
  )
  .post(
    '/:id/scan',
    requireAuth('admin', 'operator'),
    zValidator('json', scanInventoryInput),
    (c) => {
      const db = c.get('db');
      const user = c.get('user')!;
      const id = c.req.param('id');
      const { code: scanned, scannedAt: claimedAt } = c.req.valid('json');

      const session = db.select().from(inventorySessions).where(eq(inventorySessions.id, id)).get();
      if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);
      if (session.status !== 'open') {
        return c.json({ error: { message: 'Inventura je už uzavřená' } }, 409);
      }

      // Our own code first; otherwise resolve it like any other identifier
      // (a manufacturer serial/EAN barcode), but only when unambiguous.
      let asset = db.select().from(assets).where(eq(assets.code, scanned.toUpperCase())).get();
      if (!asset) {
        const matches = lookupAssetsByIdentifier(db, scanned);
        if (matches.length > 1) {
          const codes = matches.map((m) => m.asset.code).join(', ');
          return c.json(
            {
              error: {
                message: `„${scanned}" odpovídá více assetům (${codes}), naskenuj jejich kód.`,
              },
            },
            409,
          );
        }
        asset = matches[0]?.asset;
      }
      if (!asset) return c.json({ error: { message: `Asset ${scanned} nenalezen` } }, 404);

      const already = db
        .select({ id: inventoryScans.id })
        .from(inventoryScans)
        .where(and(eq(inventoryScans.sessionId, id), eq(inventoryScans.assetId, asset.id)))
        .get();

      // Whether the asset belongs to this session's expected set.
      const inScope = isInScope(db, session, asset);

      const result: ScanResultKind = already ? 'already' : inScope ? 'found' : 'unexpected';

      if (!already) {
        // Offline-queued scans carry their real time; accept it only within
        // [session start, now + 1 min] so a wrong device clock can't backdate.
        const received = new Date();
        const now =
          claimedAt &&
          claimedAt.getTime() >= session.createdAt.getTime() &&
          claimedAt.getTime() <= received.getTime() + 60_000
            ? claimedAt
            : received;
        db.insert(inventoryScans)
          .values({ sessionId: id, assetId: asset.id, scannedByUserId: user.id, scannedAt: now })
          .run();
        // Never move lastSeenAt backwards (a late-synced offline scan may be
        // older than a sighting recorded meanwhile).
        db.update(assets)
          .set({ lastSeenAt: now })
          .where(
            and(eq(assets.id, asset.id), or(isNull(assets.lastSeenAt), lt(assets.lastSeenAt, now))),
          )
          .run();
        db.insert(assetEvents)
          .values({
            assetId: asset.id,
            actorUserId: user.id,
            type: 'inventory_seen',
            payload: { sessionId: id, inScope, ...(now !== received ? { offline: true } : {}) },
            occurredAt: now,
          })
          .run();
      }

      // Return just enough for the client to patch its cached report (the
      // asset's report row + fresh counts). Sending the whole report on every
      // beep cost ~3 MB / ~90 ms at 20k assets. The service worker serves
      // GET /api/* stale-while-revalidate, so patching beats refetching.
      const scanRow = db
        .select({ scannedAt: inventoryScans.scannedAt })
        .from(inventoryScans)
        .where(and(eq(inventoryScans.sessionId, id), eq(inventoryScans.assetId, asset.id)))
        .get();
      const note = db
        .select({ note: inventoryItemNotes.note })
        .from(inventoryItemNotes)
        .where(and(eq(inventoryItemNotes.sessionId, id), eq(inventoryItemNotes.assetId, asset.id)))
        .get();
      return c.json({
        result,
        // Which report list the asset now belongs to.
        list: inScope ? 'found' : 'unexpected',
        asset: {
          id: asset.id,
          code: asset.code,
          name: asset.name,
          status: asset.status,
          locationId: asset.locationId,
          scannedAt: scanRow?.scannedAt ?? null,
          note: note?.note ?? null,
        },
        counts: reportCounts(db, session),
      });
    },
  )
  .post('/:id/close', requireAuth('admin', 'operator'), async (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    const id = c.req.param('id');
    const session = db.select().from(inventorySessions).where(eq(inventorySessions.id, id)).get();
    if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);
    if (session.status === 'closed') {
      return c.json({ error: { message: 'Inventura je už uzavřená' } }, 409);
    }
    const expectedSnapshot = expectedAssets(db, session).map((a) => a.id);
    db.update(inventorySessions)
      .set({
        status: 'closed',
        closedAt: new Date(),
        closedByUserId: user.id,
        expectedSnapshot,
        updatedAt: new Date(),
      })
      .where(eq(inventorySessions.id, id))
      .run();

    // Tell the admins how it went (and any webhook listener), so the result
    // doesn't depend on someone opening the page.
    const report = buildReport(db, { ...session, status: 'closed', expectedSnapshot });
    const env = c.get('env');
    const appUrl = env.PUBLIC_APP_URL.replace(/\/$/, '');
    emitWebhook(db, 'inventory.closed', {
      sessionId: id,
      name: session.name,
      closedBy: user.name,
      counts: report.counts,
      missing: report.missing.map((a) => a.code),
      unexpected: report.unexpected.map((a) => a.code),
    });
    const LIST_MAX = 30;
    const admins = db
      .select()
      .from(users)
      .where(eq(users.role, 'admin'))
      .all()
      .filter((u) => !u.disabledAt);
    const copy = emailCopy(env.EMAIL_LOCALE);
    for (const admin of admins) {
      const built = copy.inventoryClosed({
        adminName: admin.name,
        sessionName: session.name,
        closedBy: user.name,
        counts: report.counts,
        missing: report.missing.slice(0, LIST_MAX),
        moreMissing: Math.max(0, report.missing.length - LIST_MAX),
        unexpected: report.unexpected.slice(0, LIST_MAX),
        moreUnexpected: Math.max(0, report.unexpected.length - LIST_MAX),
        sessionUrl: appUrl ? `${appUrl}/inventory/${id}` : undefined,
        csvUrl: appUrl ? `${appUrl}/api/inventory/${id}/report.csv` : undefined,
      });
      try {
        await c
          .get('emailSender')
          .send({ to: admin.email, subject: built.subject, text: built.text });
      } catch (err) {
        console.error(`Inventory-closed email failed for ${admin.email}:`, err);
      }
    }
    return c.json({ ok: true, counts: report.counts });
  })
  .post('/:id/reopen', requireAuth('admin', 'operator'), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const session = db.select().from(inventorySessions).where(eq(inventorySessions.id, id)).get();
    if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);
    if (session.status === 'open') {
      return c.json({ error: { message: 'Inventura je už otevřená' } }, 409);
    }
    db.update(inventorySessions)
      .set({
        status: 'open',
        closedAt: null,
        closedByUserId: null,
        // Live scope again until the next close.
        expectedSnapshot: null,
        updatedAt: new Date(),
      })
      .where(eq(inventorySessions.id, id))
      .run();
    return c.json({ ok: true });
  })
  .put(
    '/:id/items/:assetId/note',
    requireAuth('admin', 'operator'),
    zValidator('json', inventoryItemNoteInput),
    (c) => {
      const db = c.get('db');
      const id = c.req.param('id');
      const assetId = c.req.param('assetId');
      const note = c.req.valid('json').note.trim();

      const session = db.select().from(inventorySessions).where(eq(inventorySessions.id, id)).get();
      if (!session) return c.json({ error: { message: 'Inventura nenalezena' } }, 404);
      const asset = db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).get();
      if (!asset) return c.json({ error: { message: 'Asset nenalezen' } }, 404);

      if (note === '') {
        db.delete(inventoryItemNotes)
          .where(and(eq(inventoryItemNotes.sessionId, id), eq(inventoryItemNotes.assetId, assetId)))
          .run();
      } else {
        db.insert(inventoryItemNotes)
          .values({ sessionId: id, assetId, note })
          .onConflictDoUpdate({
            target: [inventoryItemNotes.sessionId, inventoryItemNotes.assetId],
            set: { note, updatedAt: new Date() },
          })
          .run();
      }
      return c.json({ ok: true, report: buildReport(db, session) });
    },
  )
  .post(
    '/:id/mark-lost',
    requireAuth('admin', 'operator'),
    zValidator('json', markMissingLostInput),
    (c) => {
      const db = c.get('db');
      const user = c.get('user')!;
      const id = c.req.param('id');
      const session = db.select().from(inventorySessions).where(eq(inventorySessions.id, id)).get();
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
      return c.json({ ok: true, archived, report: buildReport(db, session) });
    },
  );
