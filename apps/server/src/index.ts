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
import { runOverdueCheck, runStartReminders } from './lib/overdue.js';
import { runWarrantyReminders } from './lib/warranty.js';
import { runServiceReminders } from './lib/service-reminders.js';
import { runWeeklyReport } from './lib/weekly-report.js';
import { pruneRateLimits } from './lib/rate-limit.js';
import { pruneOldAuditEvents } from './lib/retention.js';
import { pruneExpiredSessions } from './lib/sessions.js';
import { pruneExpiredOauth } from './mcp/oauth-store.js';

const env = loadEnv();
const { db, sqlite } = createDb(env.DATABASE_URL);
const emailSender = createEmailSender(env);

// Auto-migrate on boot. Falls back across the dev (src/index.ts) and
// production (dist/index.js) layouts so the same code works in both.
function findMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../src/db/migrations'), resolve(here, './db/migrations')];
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
const runLoanNotifiers = () => {
  void runOverdueCheck(db, emailSender, { publicAppUrl: env.PUBLIC_APP_URL }).catch((err) =>
    console.error('overdue check failed:', err),
  );
  void runStartReminders(db, emailSender, { publicAppUrl: env.PUBLIC_APP_URL }).catch((err) =>
    console.error('start reminder failed:', err),
  );
  void runWarrantyReminders(db, emailSender, { publicAppUrl: env.PUBLIC_APP_URL }).catch((err) =>
    console.error('warranty reminder failed:', err),
  );
  void runServiceReminders(db, emailSender, { publicAppUrl: env.PUBLIC_APP_URL }).catch((err) =>
    console.error('service reminder failed:', err),
  );
};
const initialTimer = setTimeout(runLoanNotifiers, 30_000);
const overdueTimer = setInterval(runLoanNotifiers, OVERDUE_INTERVAL_MS);

// Weekly inventory digest to admins. Interval-only (no run on boot) so frequent
// restarts don't spam; a long-running instance sends roughly one per week.
const WEEKLY_REPORT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const weeklyReportTimer = setInterval(() => {
  void runWeeklyReport(db, emailSender, { publicAppUrl: env.PUBLIC_APP_URL }).catch((err) =>
    console.error('weekly report failed:', err),
  );
}, WEEKLY_REPORT_INTERVAL_MS);

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
  // Drop expired MCP authorization codes (expired tokens are rejected lazily
  // at verify time, but codes accumulate otherwise).
  try {
    pruneExpiredOauth(db);
  } catch (err) {
    console.error('oauth prune failed:', err);
  }
  // Sweep expired login sessions so the table doesn't grow without bound.
  try {
    pruneExpiredSessions(db);
  } catch (err) {
    console.error('session prune failed:', err);
  }
  // Evict stale in-memory rate-limit buckets (one entry per client IP).
  try {
    pruneRateLimits();
  } catch (err) {
    console.error('rate-limit prune failed:', err);
  }
  // GDPR retention: trim audit-log history beyond the configured window.
  if (env.AUDIT_RETENTION_DAYS) {
    try {
      const removed = pruneOldAuditEvents(db, env.AUDIT_RETENTION_DAYS);
      if (removed > 0) console.log(`Retenční limit: smazáno ${removed} starých audit záznamů.`);
    } catch (err) {
      console.error('audit retention prune failed:', err);
    }
  }
};
runActivation();
const activationTimer = setInterval(runActivation, ACTIVATION_INTERVAL_MS);

const shutdown = () => {
  console.log('Vypínám…');
  clearTimeout(initialTimer);
  clearInterval(overdueTimer);
  clearInterval(weeklyReportTimer);
  clearInterval(activationTimer);
  // Force-exit fallback: if server.close() hangs (e.g. a stuck keep-alive
  // connection never drains), don't wait forever. `.unref()` so this timer
  // itself doesn't keep the process alive if close finishes promptly.
  setTimeout(() => {
    console.error('Vynucené ukončení – server.close() nedoběhl včas.');
    process.exit(1);
  }, 10_000).unref();
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
