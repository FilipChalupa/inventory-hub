import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

describe('org API — MCP connection info', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  it('derives the connector URL from PUBLIC_APP_URL and reports Google as unconfigured', async () => {
    const res = await server.authRequest('/api/org/mcp-info', { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; googleConfigured: boolean };
    // Test env sets PUBLIC_APP_URL=http://localhost:5173 and no Google creds.
    expect(body.url).toBe('http://localhost:5173/mcp');
    expect(body.googleConfigured).toBe(false);
  });

  it('requires authentication', async () => {
    const res = await server.authRequest('/api/org/mcp-info', {});
    expect(res.status).toBe(401);
  });
});

describe('org API — label settings', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  async function putJson(path: string, body: unknown, c = cookie) {
    return server.authRequest(path, {
      cookie: c,
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns default label settings before the org is initialized', async () => {
    const res = await server.authRequest('/api/org', { cookie });
    const body = (await res.json()) as {
      labelSettings: { compact: boolean; showName: boolean; note: string };
    };
    expect(body.labelSettings).toEqual({ compact: false, showName: true, note: '' });
  });

  it('persists label settings org-wide once initialized', async () => {
    expect(
      (await putJson('/api/org', { name: 'Acme', codePrefix: null, allowedDomains: [] })).status,
    ).toBe(200);

    const save = await putJson('/api/org/label-settings', {
      compact: true,
      showName: false,
      note: 'najdete-li, pište spravce@acme.cz',
    });
    expect(save.status).toBe(200);

    const res = await server.authRequest('/api/org', { cookie });
    const body = (await res.json()) as {
      labelSettings: { compact: boolean; showName: boolean; note: string };
    };
    expect(body.labelSettings).toEqual({
      compact: true,
      showName: false,
      note: 'najdete-li, pište spravce@acme.cz',
    });
  });

  it('forbids non-admins from changing label settings', async () => {
    await putJson('/api/org', { name: 'Acme', codePrefix: null, allowedDomains: [] });
    const memberCookie = server.loginAs(server.createUser({ role: 'operator' }));
    const res = await putJson(
      '/api/org/label-settings',
      { compact: true, showName: true, note: '' },
      memberCookie,
    );
    expect(res.status).toBe(403);
  });
});
