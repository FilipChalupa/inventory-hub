import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { getDbFilePath } from '../env.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(databaseUrl: string): { db: Db; sqlite: Database.Database } {
  const filePath = getDbFilePath(databaseUrl);
  mkdirSync(dirname(filePath), { recursive: true });

  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export { schema };
