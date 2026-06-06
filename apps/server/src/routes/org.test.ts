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
