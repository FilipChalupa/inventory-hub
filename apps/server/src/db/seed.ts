import { loadEnv } from '../env.js';
import { createDb } from './client.js';
import { orgSettings, users, assetTypes, locations, assets } from './schema.js';
import { sql } from 'drizzle-orm';

const env = loadEnv();
const { db, sqlite } = createDb(env.DATABASE_URL);

try {
  console.log('Seeding default org…');
  db.insert(orgSettings)
    .values({
      id: 'singleton',
      name: 'Inventory Hub (dev)',
      codePrefix: null,
      allowedDomains: [],
    })
    .onConflictDoNothing()
    .run();

  console.log('Seeding admin user…');
  const adminId = crypto.randomUUID();
  db.insert(users)
    .values({
      id: adminId,
      email: 'admin@example.com',
      name: 'Dev Admin',
      role: 'admin',
    })
    .onConflictDoNothing()
    .run();

  console.log('Seeding asset types…');
  const laptopTypeId = crypto.randomUUID();
  const monitorTypeId = crypto.randomUUID();
  db.insert(assetTypes)
    .values([
      { id: laptopTypeId, name: 'Notebook', codePrefix: 'LAP' },
      { id: monitorTypeId, name: 'Monitor', codePrefix: 'MON' },
    ])
    .onConflictDoNothing()
    .run();

  console.log('Seeding locations…');
  const officeId = crypto.randomUUID();
  const storageId = crypto.randomUUID();
  db.insert(locations)
    .values([
      { id: officeId, name: 'Kancelář', parentId: null },
      { id: storageId, name: 'Sklad', parentId: null },
    ])
    .onConflictDoNothing()
    .run();

  console.log('Seeding sample assets…');
  db.insert(assets)
    .values([
      {
        code: 'LAP-00001',
        name: 'ThinkPad X1 Carbon',
        typeId: laptopTypeId,
        locationId: officeId,
        status: 'in_stock',
      },
      {
        code: 'MON-00001',
        name: 'Dell U2723QE',
        typeId: monitorTypeId,
        locationId: storageId,
        status: 'in_stock',
      },
    ])
    .onConflictDoNothing()
    .run();

  const count = db.select({ c: sql<number>`count(*)` }).from(assets).get();
  console.log(`Hotovo. Assetů v DB: ${count?.c ?? 0}`);
} finally {
  sqlite.close();
}
