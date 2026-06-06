import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { loadEnv } from './env.js';
import { createEmailSender } from './lib/email.js';
import { activateDueLoans } from './lib/loanActivation.js';
import { runOverdueCheck } from './lib/overdue.js';

const env = loadEnv();
const { db, sqlite } = createDb(env.DATABASE_URL);
const emailSender = createEmailSender(env);

// Auto-migrate on boot. Falls back across the dev (src/index.ts) and
// production (dist/index.js) layouts so the same code works in both.
function findMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../src/db/migrations'),
    resolve(here, './db/migrations'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`Migrations folder not found. Tried: ${candidates.join(', ')}`);
}

try {
  migrate(db, { migrationsFolder: findMigrationsFolder() });
  console.log('Migrace aplikovány.');
} catch (err) {
  console.error('Migrace selhaly:', err);
  sqlite.close();
  process.exit(1);
}

const app = createApp({ db, env, emailSender });

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`Server běží na http://localhost:${info.port}`);
  },
);

// Overdue-loan notifier: run on boot (lightly delayed so DB is warm) and
// then every 6 hours. Idempotent — only sends per loan once via the
// `overdue_notified_at` column.
const OVERDUE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const initialTimer = setTimeout(() => {
  void runOverdueCheck(db, emailSender, { publicAppUrl: env.PUBLIC_APP_URL }).catch((err) =>
    console.error('overdue check failed:', err),
  );
}, 30_000);
const overdueTimer = setInterval(() => {
  void runOverdueCheck(db, emailSender, { publicAppUrl: env.PUBLIC_APP_URL }).catch((err) =>
    console.error('overdue check failed:', err),
  );
}, OVERDUE_INTERVAL_MS);

// Planned-loan activator: flips planned loans to active once their start
// moment passes. Runs every few minutes so the delay stays small; the
// manual "start" button covers the gap in between.
const ACTIVATION_INTERVAL_MS = 5 * 60 * 1000;
const runActivation = () => {
  try {
    const { activated } = activateDueLoans(db);
    if (activated > 0) console.log(`Aktivováno naplánovaných výpůjček: ${activated}`);
  } catch (err) {
    console.error('loan activation failed:', err);
  }
};
runActivation();
const activationTimer = setInterval(runActivation, ACTIVATION_INTERVAL_MS);

const shutdown = () => {
  console.log('Vypínám…');
  clearTimeout(initialTimer);
  clearInterval(overdueTimer);
  clearInterval(activationTimer);
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
