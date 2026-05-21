import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

describe('auth guards', () => {
  let server: TestServer;

  beforeEach(() => {
    server = setupTestServer();
  });

  afterEach(() => {
    server.close();
  });

  it('returns 401 for /api/* without a session cookie', async () => {
    const res = await server.app.request('/api/assets');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Nepřihlášen/);
  });

  it('returns 401 when the session cookie is unknown', async () => {
    const res = await server.authRequest('/api/assets', {
      cookie: 'inv_session=does-not-exist',
    });
    expect(res.status).toBe(401);
  });

  it('lets an authenticated user reach /api/*', async () => {
    const user = server.createUser();
    const cookie = server.loginAs(user);
    const res = await server.authRequest('/api/assets', { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('returns the user via /auth/me when authenticated', async () => {
    const user = server.createUser({ email: 'me@example.com', role: 'operator' });
    const cookie = server.loginAs(user);
    const res = await server.authRequest('/auth/me', { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      user?: { email: string; role: string };
    };
    expect(body.authenticated).toBe(true);
    expect(body.user?.email).toBe('me@example.com');
    expect(body.user?.role).toBe('operator');
  });

  it('reports unauthenticated via /auth/me without a session', async () => {
    const res = await server.app.request('/auth/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });

  describe('CSRF', () => {
    it('rejects a POST with no Origin header', async () => {
      const user = server.createUser();
      const cookie = server.loginAs(user);
      // Bypass authRequest's automatic Origin injection by calling app.request directly.
      const res = await server.app.request('/auth/logout', {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(403);
    });

    it('rejects a POST with a cross-origin Origin header', async () => {
      const user = server.createUser();
      const cookie = server.loginAs(user);
      const res = await server.app.request('/auth/logout', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'https://evil.example.com' },
      });
      expect(res.status).toBe(403);
    });

    it('allows GETs without Origin (read-only requests are not state-changing)', async () => {
      const user = server.createUser();
      const cookie = server.loginAs(user);
      const res = await server.app.request('/auth/me', {
        method: 'GET',
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
    });

    it('skips CSRF on /health (probe-friendly)', async () => {
      const res = await server.app.request('/health');
      expect([200, 204]).toContain(res.status);
    });
  });

  it('logout clears the session so the next /api/* call fails', async () => {
    const user = server.createUser();
    const cookie = server.loginAs(user);

    const ok = await server.authRequest('/api/assets', { cookie });
    expect(ok.status).toBe(200);

    const logout = await server.authRequest('/auth/logout', { cookie, method: 'POST' });
    expect(logout.status).toBe(200);

    const after = await server.authRequest('/api/assets', { cookie });
    expect(after.status).toBe(401);
  });
});
