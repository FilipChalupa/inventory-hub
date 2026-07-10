import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { loadEnv } from '../env.js';
import { createDb } from './client.js';
import { orgSettings, users, assetTypes, locations, assets } from './schema.js';

// Two profiles share most of the data. The `--e2e` profile uses
// deterministic IDs (and a stable admin email) so Playwright tests can
// reference them without runtime lookups. The default dev profile uses
// random UUIDs so reseeding doesn't change identity of existing rows.
const isE2e = process.argv.includes('--e2e');

const env = loadEnv();
const { db, sqlite } = createDb(env.DATABASE_URL);

function fixedOrRandom(fixed: string): string {
  return isE2e ? fixed : crypto.randomUUID();
}

try {
  console.log(`Seeding ${isE2e ? '(e2e profile)' : '(dev profile)'}…`);

  console.log('  org settings');
  db.insert(orgSettings)
    .values({
      id: 'singleton',
      name: isE2e ? 'Inventory Hub (e2e)' : 'Inventory Hub (dev)',
      codePrefix: null,
      allowedDomains: [],
    })
    .onConflictDoNothing()
    .run();

  console.log('  admin user');
  const adminId = fixedOrRandom('00000000-0000-0000-0000-000000000001');
  db.insert(users)
    .values({
      id: adminId,
      email: 'admin@example.com',
      name: isE2e ? 'E2E Admin' : 'Dev Admin',
      role: 'admin',
    })
    .onConflictDoNothing()
    .run();

  console.log('  asset types');
  const laptopTypeId = fixedOrRandom('00000000-0000-0000-0000-000000001001');
  const monitorTypeId = fixedOrRandom('00000000-0000-0000-0000-000000001002');
  db.insert(assetTypes)
    .values([
      { id: laptopTypeId, name: 'Notebook', codePrefix: 'LAP' },
      { id: monitorTypeId, name: 'Monitor', codePrefix: 'MON' },
    ])
    .onConflictDoNothing()
    .run();

  console.log('  locations');
  if (isE2e) {
    // Deterministic IDs + an idempotent upsert so reseeding doesn't dup
    // (locations have no natural unique key beyond id).
    const officeId = '00000000-0000-0000-0000-000000002001';
    const storageId = '00000000-0000-0000-0000-000000002002';
    const existing = new Set(
      db
        .select({ id: locations.id })
        .from(locations)
        .all()
        .map((r) => r.id),
    );
    if (!existing.has(officeId)) {
      db.insert(locations).values({ id: officeId, name: 'Kancelář', parentId: null }).run();
    }
    if (!existing.has(storageId)) {
      db.insert(locations).values({ id: storageId, name: 'Sklad', parentId: null }).run();
    }
  } else {
    db.insert(locations)
      .values([
        { id: crypto.randomUUID(), name: 'Kancelář', parentId: null },
        { id: crypto.randomUUID(), name: 'Sklad', parentId: null },
      ])
      .run();
  }

  console.log('  sample assets');
  // assets table has a unique constraint on `code`, so onConflictDoNothing
  // is naturally idempotent across reseeds.
  const officeForAsset = isE2e
    ? '00000000-0000-0000-0000-000000002001'
    : db.select({ id: locations.id }).from(locations).where(eq(locations.name, 'Kancelář')).get()
        ?.id;
  const storageForAsset = isE2e
    ? '00000000-0000-0000-0000-000000002002'
    : db.select({ id: locations.id }).from(locations).where(eq(locations.name, 'Sklad')).get()?.id;

  db.insert(assets)
    .values([
      {
        code: 'LAP-00001',
        name: 'ThinkPad X1 Carbon',
        typeId: laptopTypeId,
        locationId: officeForAsset ?? null,
        status: 'in_stock',
      },
      {
        code: 'MON-00001',
        name: 'Dell U2723QE',
        typeId: monitorTypeId,
        locationId: storageForAsset ?? null,
        status: 'in_stock',
      },
    ])
    .onConflictDoNothing()
    .run();

  const count = db
    .select({ c: sql<number>`count(*)` })
    .from(assets)
    .get();
  console.log(`Hotovo. Assetů v DB: ${count?.c ?? 0}`);
} finally {
  sqlite.close();
}
