import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

async function jsonPost(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('API keys', () => {
  let server: TestServer;
  let adminCookie: string;

  beforeEach(() => {
    server = setupTestServer();
    adminCookie = server.loginAs(server.createUser({ role: 'admin', email: 'admin@example.com' }));
  });

  afterEach(() => server.close());

  it('creates a key and authenticates a bearer request with it', async () => {
    const res = await jsonPost(server, adminCookie, '/api/api-keys', { name: 'CI' });
    expect(res.status).toBe(201);
    const { token, id } = (await res.json()) as { token: string; id: string };
    expect(token).toMatch(/^ihk_/);

    // The key authenticates against a protected endpoint without a cookie.
    const assets = await server.authRequest('/api/assets', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(assets.status).toBe(200);

    // Listing never leaks the token, only its prefix.
    const list = await server.authRequest('/api/api-keys', { cookie: adminCookie });
    const body = (await list.json()) as { items: { id: string; prefix: string; token?: string }[] };
    const row = body.items.find((k) => k.id === id)!;
    expect(row.token).toBeUndefined();
    expect(token.startsWith(row.prefix)).toBe(true);
  });

  it('rejects an unknown or revoked bearer token on /api/*', async () => {
    const bad = await server.authRequest('/api/assets', {
      headers: { authorization: 'Bearer ihk_nope' },
    });
    expect(bad.status).toBe(401);

    const created = await jsonPost(server, adminCookie, '/api/api-keys', { name: 'tmp' });
    const { token, id } = (await created.json()) as { token: string; id: string };
    await server.authRequest(`/api/api-keys/${id}`, { cookie: adminCookie, method: 'DELETE' });

    const after = await server.authRequest('/api/assets', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  it('only admins can manage keys', async () => {
    const memberCookie = server.loginAs(server.createUser({ role: 'member', email: 'm@e.cz' }));
    const create = await jsonPost(server, memberCookie, '/api/api-keys', { name: 'x' });
    expect(create.status).toBe(403);
    const list = await server.authRequest('/api/api-keys', { cookie: memberCookie });
    expect(list.status).toBe(403);
  });

  it('scopes a key: feeds-only cannot reach /api/*, api-only cannot read the feed', async () => {
    // A feeds-only key — the safe kind for a calendar URL.
    const feedRes = await jsonPost(server, adminCookie, '/api/api-keys', {
      name: 'Kalendář',
      scopes: ['feeds'],
    });
    expect(feedRes.status).toBe(201);
    const feedKey = (await feedRes.json()) as { token: string; scopes: string[] };
    expect(feedKey.scopes).toEqual(['feeds']);

    // It is powerless against the REST API…
    const api = await server.authRequest('/api/assets', {
      headers: { authorization: `Bearer ${feedKey.token}` },
    });
    expect(api.status).toBe(401);

    // …but can read the calendar feed.
    const feed = await server.authRequest(`/feeds/loans.ics?token=${feedKey.token}`, {});
    expect(feed.status).toBe(200);
    expect(feed.headers.get('content-type')).toMatch(/text\/calendar/);

    // An api-only key is the mirror image: REST works, the feed is forbidden.
    const apiRes = await jsonPost(server, adminCookie, '/api/api-keys', {
      name: 'Skript',
      scopes: ['api'],
    });
    const apiKey = (await apiRes.json()) as { token: string };
    const rest = await server.authRequest('/api/assets', {
      headers: { authorization: `Bearer ${apiKey.token}` },
    });
    expect(rest.status).toBe(200);
    const forbidden = await server.authRequest(`/feeds/loans.ics?token=${apiKey.token}`, {});
    expect(forbidden.status).toBe(403);
  });

  it('defaults a key with no scopes to api-only', async () => {
    const res = await jsonPost(server, adminCookie, '/api/api-keys', { name: 'default' });
    const { token, scopes } = (await res.json()) as { token: string; scopes: string[] };
    expect(scopes).toEqual(['api']);
    const feed = await server.authRequest(`/feeds/loans.ics?token=${token}`, {});
    expect(feed.status).toBe(403);
  });

  it('allows a bearer POST without tripping CSRF', async () => {
    const created = await jsonPost(server, adminCookie, '/api/api-keys', { name: 'writer' });
    const { token } = (await created.json()) as { token: string };

    // No cookie, foreign Origin — would be CSRF-blocked for a browser, but
    // bearer requests are exempt.
    const res = await server.authRequest('/api/contacts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ name: 'Via API' }),
    });
    expect([200, 201]).toContain(res.status);
  });
});

describe('OpenAPI', () => {
  let server: TestServer;
  beforeEach(() => {
    server = setupTestServer();
  });
  afterEach(() => server.close());

  it('serves a public spec with Zod-derived schemas', async () => {
    const spec = await server.authRequest('/openapi.json', {});
    expect(spec.status).toBe(200);
    const body = (await spec.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    expect(body.openapi).toMatch(/^3\./);
    expect(body.paths['/api/loans']).toBeTruthy();
    // Derived from the shared Zod createLoanInput, not hand-written.
    const createLoan = body.components.schemas.CreateLoan;
    expect(createLoan).toBeDefined();
    expect(createLoan!.properties).toHaveProperty('assetCodes');
    expect(createLoan!.properties).toHaveProperty('borrowerName');
  });

  it('serves a self-hosted docs page and its assets (no CDN)', async () => {
    const docs = await server.authRequest('/docs', {});
    expect(docs.status).toBe(200);
    expect(docs.headers.get('content-type')).toMatch(/text\/html/);
    const html = await docs.text();
    expect(html).toContain('/docs/swagger-ui-bundle.js');
    expect(html).not.toContain('cdn.jsdelivr');

    const css = await server.authRequest('/docs/swagger-ui.css', {});
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toMatch(/text\/css/);

    const bundle = await server.authRequest('/docs/swagger-ui-bundle.js', {});
    expect(bundle.status).toBe(200);

    // Path traversal via the file param must be rejected. Encoded so URL
    // normalization doesn't collapse `../` before it reaches the docs route
    // (a bare `/docs/../package.json` normalizes to `/package.json` and would
    // be swallowed by the SPA fallback instead of exercising this guard).
    const bad = await server.authRequest('/docs/..%2f..%2fpackage.json', {});
    expect(bad.status).toBe(404);
  });
});
