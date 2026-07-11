import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { orgSettings } from '../db/schema.js';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

describe('public lookup (/p/:code)', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  async function makeAsset(code: string, name: string) {
    await server.authRequest('/api/assets', {
      cookie,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, code }),
    });
  }

  function setPublic(enabled: boolean) {
    server.db
      .update(orgSettings)
      .set({ publicLookupEnabled: enabled })
      .where(eq(orgSettings.id, 'singleton'))
      .run();
  }

  it('serves a minimal public page when enabled', async () => {
    await makeAsset('LAP-70001', 'Public Laptop');
    setPublic(true);

    const res = await server.app.request('/p/LAP-70001');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Public Laptop');
    expect(html).toContain('LAP-70001');
  });

  it('404s when the feature is disabled', async () => {
    await makeAsset('LAP-70002', 'Hidden');
    setPublic(false);

    const res = await server.app.request('/p/LAP-70002');
    expect(res.status).toBe(404);
  });

  it('does not require authentication', async () => {
    await makeAsset('LAP-70003', 'No Auth Needed');
    setPublic(true);

    // No cookie at all.
    const res = await server.app.request('/p/LAP-70003');
    expect(res.status).toBe(200);
  });
});
