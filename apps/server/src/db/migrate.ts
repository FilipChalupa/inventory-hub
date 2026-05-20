import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { loadEnv } from '../env.js';
import { createDb } from './client.js';

const env = loadEnv();
const { db, sqlite } = createDb(env.DATABASE_URL);

try {
  migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log('Migrace dokončeny.');
} finally {
  sqlite.close();
}
