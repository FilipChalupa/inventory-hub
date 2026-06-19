/**
 * One-time importer for data exported from the Kilomayo workspace
 * `internal_inventory_*` tables. Reads the JSON produced by the monorepo
 * script `scripts/export-internal-inventory.ts` and writes it straight into
 * the Inventory Hub SQLite database via Drizzle (bypassing the REST
 * validation, which is what we want for a bulk migration).
 *
 *   tsx src/db/migrate-from-kilomayo.ts <path-to-inventory-export.json>
 *
 * Idempotent: assets keyed by `code` (= source identifier), types/locations
 * by name, the migration user by a fixed id. A second run skips everything
 * already present, including the (expensive) photo downloads.
 *
 * Decisions baked in (see migration notes):
 *  - source `identifier` becomes the asset `code` verbatim;
 *  - `quantity > 1` explodes into N rows with `-01…-NN` code suffixes;
 *  - photos are downloaded and stored into UPLOAD_DIR in the same run.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../env.js';
import { createDb, type Db } from './client.js';
import {
  assetEvents,
  assetTypes,
  assets,
  damageReports,
  loanItems,
  loans,
  locations,
  users,
} from './schema.js';

// Stable id so reruns reuse the same actor instead of creating duplicates.
const MIGRATION_USER_ID = '00000000-0000-0000-0000-0000000000aa';
const MIGRATION_USER_EMAIL = 'migration@inventory-hub.local';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

type Iso = string | null;

interface SourceAssetType {
  id: string;
  name: string;
  description: string | null;
  photo_id: string | null;
}
interface SourceLocation {
  id: string;
  name: string;
  description: string | null;
  photo_id: string | null;
}
interface SourceAsset {
  id: string;
  identifier: string;
  description: string | null;
  condition: string;
  purchase_price: string | null;
  warranty_expires_at: Iso;
  quantity: number;
  type_id: string | null;
  storage_location_id: string | null;
  archival_id: string | null;
  photo_id: string | null;
  created_at: Iso;
}
interface SourceArchival {
  id: string;
  reason: string;
  created_at: Iso;
}
interface SourceDefect {
  id: string;
  asset_id: string | null;
  description: string;
  photo_id: string | null;
  created_at: Iso;
}
interface SourceLoan {
  id: string;
  borrower: string | null;
  lender: string | null;
  note: string | null;
  loaned_at: Iso;
  expected_return_at: Iso;
  returned_at: Iso;
  created_at: Iso;
}
interface SourceLoanAsset {
  internal_inventory_loan_id: string;
  internal_inventory_asset_id: string;
}
interface SourceImage {
  id: string;
  url: string;
  file_name: string | null;
  type: string | null;
}
interface ExportFile {
  assetTypes: SourceAssetType[];
  storageLocations: SourceLocation[];
  assets: SourceAsset[];
  archivals: SourceArchival[];
  defects: SourceDefect[];
  loans: SourceLoan[];
  loanAssets: SourceLoanAsset[];
  images: SourceImage[];
}

function toDate(iso: Iso): Date | null {
  return iso ? new Date(iso) : null;
}

/** Derives an uppercase alphanumeric code prefix from a type name, unique
 * within `used`. Falls back to TYPE / TYPE2 / … when nothing usable remains. */
function derivePrefix(name: string, used: Set<string>): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4) || 'TYPE';
  let candidate = base;
  let n = 1;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${base}${n}`;
  }
  used.add(candidate);
  return candidate;
}

function load(path: string): ExportFile {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as ExportFile;
}

/** Inserts all structured rows in a single synchronous transaction and
 * returns the maps needed for the (async) photo pass that follows. */
function importStructured(
  db: Db,
  data: ExportFile,
): {
  assetCodeBySourceId: Map<string, string[]>;
  damageIdByDefectId: Map<string, string>;
  createdAssets: number;
} {
  // Existing state → idempotent reruns.
  const existingTypeByName = new Map<string, string>();
  const usedPrefixes = new Set<string>();
  for (const t of db.select().from(assetTypes).all()) {
    existingTypeByName.set(t.name, t.id);
    usedPrefixes.add(t.codePrefix.toUpperCase());
  }
  const existingLocationByName = new Map<string, string>();
  for (const l of db.select().from(locations).all()) {
    existingLocationByName.set(l.name, l.id);
  }
  const existingCodes = new Set(
    db
      .select({ code: assets.code })
      .from(assets)
      .all()
      .map((r) => r.code),
  );

  const archivalById = new Map(data.archivals.map((a) => [a.id, a]));

  // Source asset ids that are out on a loan that was never returned → on_loan.
  const returnedByLoan = new Map(data.loans.map((l) => [l.id, l.returned_at]));
  const onLoanSourceAssetIds = new Set<string>();
  for (const la of data.loanAssets) {
    if (returnedByLoan.get(la.internal_inventory_loan_id) == null) {
      onLoanSourceAssetIds.add(la.internal_inventory_asset_id);
    }
  }

  const typeIdBySourceId = new Map<string, string>();
  const typeNameBySourceId = new Map<string, string>();
  const locationIdBySourceId = new Map<string, string>();
  const assetCodeBySourceId = new Map<string, string[]>();
  const damageIdByDefectId = new Map<string, string>();
  let createdAssets = 0;

  db.transaction((tx) => {
    tx.insert(users)
      .values({
        id: MIGRATION_USER_ID,
        email: MIGRATION_USER_EMAIL,
        name: 'Migrace z Kilomayo',
        role: 'admin',
      })
      .onConflictDoNothing()
      .run();

    // Asset types.
    for (const t of data.assetTypes) {
      typeNameBySourceId.set(t.id, t.name);
      const existing = existingTypeByName.get(t.name);
      if (existing) {
        typeIdBySourceId.set(t.id, existing);
        continue;
      }
      const id = crypto.randomUUID();
      const codePrefix = derivePrefix(t.name, usedPrefixes);
      tx.insert(assetTypes).values({ id, name: t.name, codePrefix }).run();
      existingTypeByName.set(t.name, id);
      typeIdBySourceId.set(t.id, id);
    }

    // Storage locations → flat locations.
    for (const l of data.storageLocations) {
      const existing = existingLocationByName.get(l.name);
      if (existing) {
        locationIdBySourceId.set(l.id, existing);
        continue;
      }
      const id = crypto.randomUUID();
      tx.insert(locations).values({ id, name: l.name, parentId: null }).run();
      existingLocationByName.set(l.name, id);
      locationIdBySourceId.set(l.id, id);
    }

    // Assets (exploded by quantity).
    for (const a of data.assets) {
      const typeId = a.type_id ? typeIdBySourceId.get(a.type_id) ?? null : null;
      const typeName = a.type_id ? typeNameBySourceId.get(a.type_id) ?? null : null;
      const locationId = a.storage_location_id
        ? locationIdBySourceId.get(a.storage_location_id) ?? null
        : null;
      const archival = a.archival_id ? archivalById.get(a.archival_id) : null;
      const archivedAt = archival ? toDate(archival.created_at) : null;
      const isOnLoan = onLoanSourceAssetIds.has(a.id);
      const status = archivedAt ? 'retired' : isOnLoan ? 'on_loan' : 'in_stock';
      const createdAt = toDate(a.created_at) ?? undefined;

      const baseName = a.description?.trim() || typeName || a.identifier;
      const qty = Math.max(1, Math.floor(a.quantity || 1));
      const codes: string[] = [];

      for (let unit = 0; unit < qty; unit++) {
        const code =
          qty === 1 ? a.identifier : `${a.identifier}-${String(unit + 1).padStart(2, '0')}`;
        if (existingCodes.has(code)) {
          codes.push(code); // already imported — keep the mapping, skip insert
          continue;
        }
        existingCodes.add(code);

        const customFields: Record<string, unknown> = {
          condition: a.condition,
          legacyId: a.id,
        };
        if (a.purchase_price) customFields.purchasePrice = a.purchase_price;
        if (a.warranty_expires_at) customFields.warrantyExpiresAt = a.warranty_expires_at;
        if (qty > 1) customFields.unit = `${unit + 1}/${qty}`;

        const id = crypto.randomUUID();
        tx.insert(assets)
          .values({
            id,
            code,
            name: baseName,
            typeId,
            locationId,
            status,
            archivedAt,
            customFields,
            notes: null,
            ...(createdAt ? { createdAt } : {}),
          })
          .run();
        tx.insert(assetEvents)
          .values({
            assetId: id,
            actorUserId: MIGRATION_USER_ID,
            type: 'created',
            payload: { code, source: 'kilomayo-migration', legacyId: a.id },
            ...(createdAt ? { occurredAt: createdAt } : {}),
          })
          .run();
        if (archival) {
          tx.insert(assetEvents)
            .values({
              assetId: id,
              actorUserId: MIGRATION_USER_ID,
              type: 'archived',
              payload: { status: 'retired', reason: archival.reason },
              ...(archivedAt ? { occurredAt: archivedAt } : {}),
            })
            .run();
        }
        codes.push(code);
        createdAssets += 1;
      }
      assetCodeBySourceId.set(a.id, codes);
    }

    // Defects → damage reports (attached to the first unit of the asset).
    for (const d of data.defects) {
      if (!d.asset_id) continue;
      const code = assetCodeBySourceId.get(d.asset_id)?.[0];
      if (!code) continue;
      const asset = tx.select({ id: assets.id }).from(assets).where(eq(assets.code, code)).get();
      if (!asset) continue;
      // Skip if a damage report from this defect already exists.
      const id = crypto.randomUUID();
      const occurredAt = toDate(d.created_at) ?? new Date(0);
      tx.insert(damageReports)
        .values({
          id,
          assetId: asset.id,
          occurredAt,
          reportedAt: occurredAt,
          reportedByUserId: MIGRATION_USER_ID,
          description: d.description,
          severity: 'minor',
          resolvedAt: null,
        })
        .run();
      damageIdByDefectId.set(d.id, id);
    }

    // Loans → loans + loan items.
    for (const l of data.loans) {
      const loanId = crypto.randomUUID();
      const loanedAt = toDate(l.loaned_at) ?? toDate(l.created_at) ?? new Date(0);
      const purpose =
        [l.note, l.lender ? `Půjčil: ${l.lender}` : null].filter(Boolean).join(' — ') || null;
      tx.insert(loans)
        .values({
          id: loanId,
          borrowerName: l.borrower?.trim() || 'Neznámý',
          purpose,
          loanedAt,
          startedAt: toDate(l.loaned_at),
          expectedReturnAt: toDate(l.expected_return_at),
          createdByUserId: MIGRATION_USER_ID,
          ...(toDate(l.created_at) ? { createdAt: toDate(l.created_at)! } : {}),
        })
        .run();

      const sourceAssetIds = data.loanAssets
        .filter((la) => la.internal_inventory_loan_id === l.id)
        .map((la) => la.internal_inventory_asset_id);
      for (const sourceAssetId of sourceAssetIds) {
        const code = assetCodeBySourceId.get(sourceAssetId)?.[0];
        if (!code) continue;
        const asset = tx.select({ id: assets.id }).from(assets).where(eq(assets.code, code)).get();
        if (!asset) continue;
        tx.insert(loanItems)
          .values({
            id: crypto.randomUUID(),
            loanId,
            assetId: asset.id,
            returnedAt: toDate(l.returned_at),
          })
          .run();
      }
    }
  });

  return { assetCodeBySourceId, damageIdByDefectId, createdAssets };
}

function relativeUploadPath(ext: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
}

/** Downloads `url` into UPLOAD_DIR and returns the stored relative path, or
 * null when the download/type is unusable (logged, never throws). */
async function downloadImage(
  url: string,
  contentTypeHint: string | null,
  uploadDir: string,
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ! foto ${url} → HTTP ${res.status}`);
      return null;
    }
    const mime = (res.headers.get('content-type') ?? contentTypeHint ?? '').split(';')[0]!.trim();
    const ext = EXT_BY_MIME[mime] ?? url.split('.').pop()?.toLowerCase().slice(0, 4);
    if (!ext) {
      console.warn(`  ! foto ${url} → neznámý typ (${mime})`);
      return null;
    }
    const rel = relativeUploadPath(ext);
    const abs = resolve(uploadDir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.from(await res.arrayBuffer()));
    return rel;
  } catch (err) {
    console.warn(`  ! foto ${url} → ${(err as Error).message}`);
    return null;
  }
}

async function importPhotos(
  db: Db,
  data: ExportFile,
  maps: {
    assetCodeBySourceId: Map<string, string[]>;
    damageIdByDefectId: Map<string, string>;
  },
  uploadDir: string,
): Promise<number> {
  const imageById = new Map(data.images.map((i) => [i.id, i]));
  let migrated = 0;

  // Asset photos → photoPaths of the first unit (where the photo logically
  // belongs; exploded units share no extra copies).
  for (const a of data.assets) {
    if (!a.photo_id) continue;
    const image = imageById.get(a.photo_id);
    const code = maps.assetCodeBySourceId.get(a.id)?.[0];
    if (!image || !code) continue;
    const asset = db.select().from(assets).where(eq(assets.code, code)).get();
    if (!asset) continue;
    if ((asset.photoPaths ?? []).length > 0) continue; // already migrated
    const rel = await downloadImage(image.url, image.type, uploadDir);
    if (!rel) continue;
    db.update(assets)
      .set({ photoPaths: [rel], updatedAt: new Date() })
      .where(eq(assets.id, asset.id))
      .run();
    migrated += 1;
  }

  // Defect photos → the matching damage report.
  for (const d of data.defects) {
    if (!d.photo_id) continue;
    const image = imageById.get(d.photo_id);
    const damageId = maps.damageIdByDefectId.get(d.id);
    if (!image || !damageId) continue;
    const report = db.select().from(damageReports).where(eq(damageReports.id, damageId)).get();
    if (!report || (report.photoPaths ?? []).length > 0) continue;
    const rel = await downloadImage(image.url, image.type, uploadDir);
    if (!rel) continue;
    db.update(damageReports)
      .set({ photoPaths: [rel] })
      .where(eq(damageReports.id, damageId))
      .run();
    migrated += 1;
  }

  return migrated;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Usage: tsx src/db/migrate-from-kilomayo.ts <export.json>');
  }
  const env = loadEnv();
  const data = load(resolve(inputPath));
  const { db, sqlite } = createDb(env.DATABASE_URL);

  try {
    console.log(
      `Import: ${data.assets.length} assetů, ${data.assetTypes.length} typů, ` +
        `${data.storageLocations.length} lokací, ${data.loans.length} výpůjček, ` +
        `${data.defects.length} defektů, ${data.images.length} fotek.`,
    );
    const maps = importStructured(db, data);
    console.log(`  ${maps.createdAssets} nových asset řádků zapsáno.`);

    const uploadDir = resolve(env.UPLOAD_DIR);
    const photos = await importPhotos(db, data, maps, uploadDir);
    console.log(`  ${photos} fotek staženo do ${uploadDir}.`);
    console.log('Hotovo.');
  } finally {
    sqlite.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
