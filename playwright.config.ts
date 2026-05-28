import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5173);
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3101);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false, // single shared SQLite — keep tests serial
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Backend boots with auto-migrate + clean SQLite per run, then we
      // seed before tests via global setup. Both paths must be resolved
      // from the apps/server CWD because that's where the npm workspace
      // script runs from.
      command:
        `rm -rf apps/server/.e2e && mkdir -p apps/server/.e2e/uploads && ` +
        `DATABASE_URL=file:.e2e/app.db UPLOAD_DIR=.e2e/uploads ` +
        `PORT=${SERVER_PORT} ` +
        `NODE_ENV=development ` +
        `PUBLIC_APP_URL=${BASE_URL} ` +
        `npm run -s --workspace @inventory-hub/server dev`,
      port: SERVER_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `VITE_API_PROXY=http://127.0.0.1:${SERVER_PORT} npm run -s --workspace @inventory-hub/web dev -- --port ${PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  globalSetup: './e2e/global-setup.ts',
});
