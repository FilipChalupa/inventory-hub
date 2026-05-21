import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../db/schema.js';
import type { Db } from '../db/client.js';

/**
 * In-memory SQLite database with applied migrations, for tests.
 * Caller is responsible for closing `sqlite` (typically in `afterEach`).
 */
export function createTestDb(): { db: Db; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './src/db/migrations' });
  return { db, sqlite };
}
