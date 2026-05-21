/**
 * Playwright global setup. Runs once before all tests.
 *
 * The webServer config has already booted the API server (which runs
 * `migrate(...)` on startup). All we have to do here is wait for the
 * `/health` endpoint and seed the e2e fixture so the dev-login flow has
 * a known admin user to log in as.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

async function waitForHealth(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Health endpoint did not come up: ${url}`);
}

export default async function globalSetup(): Promise<void> {
  const serverPort = process.env.E2E_SERVER_PORT ?? '3101';
  await waitForHealth(`http://127.0.0.1:${serverPort}/health`);

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..');
  const seed = spawnSync(
    'npm',
    ['run', '-s', '--workspace', '@inventory-hub/server', 'db:seed'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: 'file:.e2e/app.db',
        SESSION_SECRET: 'e2e-test-secret-at-least-16-chars',
      },
      stdio: 'inherit',
    },
  );
  if (seed.status !== 0) throw new Error('E2E seed failed');
}
