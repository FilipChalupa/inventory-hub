import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestServer, type TestServer } from '../lib/test-server.js';
import { assetEvents, oauthClients, oauthTokens } from '../db/schema.js';
import { createPersonalToken } from './connections.js';
import { runMcpTokenExpiryReminders } from './notify.js';
import {
  issueTokens,
  pruneExpiredOauth,
  registerClient,
  rotateRefreshToken,
} from './oauth-store.js';
import { createMcpRuntime } from './server.js';

let server: TestServer;
beforeEach(() => {
  server = setupTestServer();
});
afterEach(() => server.close());

const DAY = 24 * 60 * 60 * 1000;

const initRequestBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 't', version: '1' },
  },
};

function initRequest() {
  return new Request('http://localhost:5173/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
    }),
  });
}

describe('MCP session housekeeping', () => {
  it('expires idle sessions and caps the total', async () => {
    let clock = 0;
    const runtime = createMcpRuntime(
      { db: server.db, env: server.env, emailSender: { send: async () => undefined } },
      { idleTtlMs: 1000, maxSessions: 3, now: () => clock },
    );
    const auth = { token: 't', clientId: 'c', scopes: [] };
    for (let i = 0; i < 5; i++) await runtime.handle(initRequest(), auth);
    // The 4th and 5th initialize each evicted the least recently used one.
    expect(runtime.sessionCount()).toBe(3);

    clock = 5000;
    await runtime.handle(initRequest(), auth);
    expect(runtime.sessionCount()).toBe(1);
  });
});

describe('pruneExpiredOauth', () => {
  it('drops rotated/expired tokens and unused clients, keeps live ones', () => {
    const user = server.createUser();
    const live = registerClient(server.db, { redirectUris: ['http://x/cb'], clientName: 'Live' });
    const stale = registerClient(server.db, { redirectUris: ['http://x/cb'], clientName: 'Stale' });
    const t = issueTokens(server.db, {
      clientId: live.client.id,
      userId: user.id,
      scope: 'mcp:read',
      audience: null,
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    });
    rotateRefreshToken(server.db, t.refreshToken, {
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    });
    createPersonalToken(server.db, { user, name: 'old', access: 'read', expiresInDays: 30 });

    const later = new Date(Date.now() + 40 * DAY);
    // Live client's newest row would be expired by then too, so prune "now+2d":
    const soon = new Date(Date.now() + 2 * DAY);
    const r1 = pruneExpiredOauth(server.db, soon);
    // Rotated-away row (past its grace period) + the newest row (refresh TTL 1h).
    expect(r1.tokens).toBe(2);
    expect(r1.clients).toBe(0); // registered <30 days ago

    const r2 = pruneExpiredOauth(server.db, later);
    expect(r2.tokens).toBe(1); // the personal token expired after 30 days
    const left = server.db.select({ id: oauthClients.id }).from(oauthClients).all();
    expect(left.map((c) => c.id)).toEqual(['personal-token']);
    expect(left).not.toContainEqual({ id: stale.client.id });
  });

  it('carries connectedAt and lastUsedAt across refresh rotation', () => {
    const user = server.createUser();
    const { client } = registerClient(server.db, { redirectUris: ['http://x/cb'] });
    const t = issueTokens(server.db, {
      clientId: client.id,
      userId: user.id,
      scope: 'mcp:read',
      audience: null,
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    });
    const first = server.db.select().from(oauthTokens).get()!;
    const used = new Date(Date.now() - 1000);
    server.db.update(oauthTokens).set({ lastUsedAt: used }).run();
    const rotated = rotateRefreshToken(server.db, t.refreshToken, {
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    })!;
    const fresh = server.db
      .select()
      .from(oauthTokens)
      .all()
      .find((r) => r.id !== first.id)!;
    expect(rotated).toBeTruthy();
    expect(fresh.connectedAt).toEqual(first.connectedAt);
    expect(fresh.lastUsedAt).toEqual(used);
  });
});

describe('MCP emails, history and attribution', () => {
  it('emails the user and records history when a personal token is created', async () => {
    const user = server.createUser({ role: 'operator' });
    const cookie = server.loginAs(user);
    const res = await server.authRequest('/api/mcp-connections/tokens', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bot', access: 'read-write' }),
    });
    const created = (await res.json()) as { id: string; token: string };
    expect(server.sentEmails.at(-1)).toMatchObject({ to: user.email });
    expect(server.sentEmails.at(-1)!.text).toContain('Bot');
    expect(server.sentEmails.at(-1)!.text).toContain('/agents');

    // An action through MCP is attributed to the agent in the audit trail.
    const call = (id: number, name: string, args: unknown, sid?: string) =>
      server.app.request('http://localhost:5173/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${created.token}`,
          ...(sid ? { 'mcp-session-id': sid } : {}),
        },
        body: JSON.stringify(
          name === 'initialize'
            ? {
                jsonrpc: '2.0',
                id,
                method: 'initialize',
                params: {
                  protocolVersion: '2025-06-18',
                  capabilities: {},
                  clientInfo: { name: 't', version: '1' },
                },
              }
            : { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
        ),
      });
    const sid = (await call(1, 'initialize', {})).headers.get('mcp-session-id')!;
    await call(2, 'create_asset', { name: 'Via agent', typeId: server.laptopTypeId }, sid);
    // …while the same action in the web app is not.
    await server.authRequest('/api/assets', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Direct', typeId: server.laptopTypeId }),
    });
    const created2 = server.db
      .select()
      .from(assetEvents)
      .where(eq(assetEvents.type, 'created'))
      .all();
    expect(created2.map((e) => [e.payload.name, e.via])).toEqual(
      expect.arrayContaining([
        ['Via agent', 'Bot'],
        ['Direct', null],
      ]),
    );

    await server.authRequest(`/api/mcp-connections/tokens/${created.id}`, {
      method: 'DELETE',
      cookie,
    });
    const history = (await (
      await server.authRequest('/api/mcp-connections/events', { cookie })
    ).json()) as { items: { type: string; connectionName: string }[] };
    expect(history.items.map((e) => e.type)).toEqual(['revoked', 'token_created']);
    expect(history.items[0]!.connectionName).toBe('Bot');
  });

  it('reminds once about personal tokens expiring within a week', async () => {
    const user = server.createUser();
    createPersonalToken(server.db, { user, name: 'Soon', access: 'read', expiresInDays: 30 });
    createPersonalToken(server.db, { user, name: 'Later', access: 'read', expiresInDays: 90 });
    createPersonalToken(server.db, { user, name: 'Never', access: 'read', expiresInDays: null });

    const now = new Date(Date.now() + 25 * DAY);
    const opts = { now, publicAppUrl: 'https://inv.example' };
    expect(
      await runMcpTokenExpiryReminders(
        server.db,
        { send: async (e) => void server.sentEmails.push(e) },
        opts,
      ),
    ).toEqual({ notifiedUsers: 1 });
    const mail = server.sentEmails.at(-1)!;
    expect(mail.text).toContain('Soon');
    expect(mail.text).not.toContain('Later');
    expect(mail.text).toContain('https://inv.example/agents');
    expect(
      await runMcpTokenExpiryReminders(server.db, { send: async () => undefined }, opts),
    ).toEqual({ notifiedUsers: 0 });
  });
});

describe('refresh token reuse', () => {
  async function refresh(clientId: string, refreshToken: string) {
    return server.app.request('http://localhost:5173/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    });
  }

  it('replaying a rotated refresh token revokes the whole family and tells the user', async () => {
    const user = server.createUser();
    const { client } = registerClient(server.db, {
      redirectUris: ['http://x/cb'],
      clientName: 'Leaky',
    });
    const first = issueTokens(server.db, {
      clientId: client.id,
      userId: user.id,
      scope: 'mcp:read',
      audience: null,
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    });
    // A second, independent authorization of the same client survives.
    issueTokens(server.db, {
      clientId: client.id,
      userId: user.id,
      scope: 'mcp:read',
      audience: null,
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    });

    const ok = await refresh(client.id, first.refreshToken);
    expect(ok.status).toBe(200);
    const fresh = (await ok.json()) as { refresh_token: string };

    // The old refresh token shows up again → theft assumed.
    expect((await refresh(client.id, first.refreshToken)).status).toBe(400);
    // …and the legitimately rotated one is dead too.
    expect((await refresh(client.id, fresh.refresh_token)).status).toBe(400);
    expect(server.db.select().from(oauthTokens).all()).toHaveLength(1);

    expect(server.sentEmails.at(-1)).toMatchObject({ to: user.email });
    expect(server.sentEmails.at(-1)!.subject).toContain('Leaky');
  });

  it('a refresh token presented by another client is rejected without rotating', async () => {
    const user = server.createUser();
    const a = registerClient(server.db, { redirectUris: ['http://x/cb'] }).client;
    const b = registerClient(server.db, { redirectUris: ['http://x/cb'] }).client;
    const t = issueTokens(server.db, {
      clientId: a.id,
      userId: user.id,
      scope: 'mcp:read',
      audience: null,
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    });
    expect((await refresh(b.id, t.refreshToken)).status).toBe(400);
    expect((await refresh(a.id, t.refreshToken)).status).toBe(200);
  });
});

describe('MCP rate limit', () => {
  it('throttles one token without affecting another', async () => {
    const limited = setupTestServer({ MCP_RATE_LIMIT_PER_MIN: 2 });
    try {
      const user = limited.createUser();
      const mk = () =>
        createPersonalToken(limited.db, { user, name: 'x', access: 'read', expiresInDays: 30 })
          .token;
      const [busy, calm] = [mk(), mk()];
      const ping = (token: string) =>
        limited.app.request('http://localhost:5173/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(initRequestBody),
        });
      expect((await ping(busy)).status).toBe(200);
      expect((await ping(busy)).status).toBe(200);
      const third = await ping(busy);
      expect(third.status).toBe(429);
      expect(third.headers.get('retry-after')).toBeTruthy();
      expect((await ping(calm)).status).toBe(200);
    } finally {
      limited.close();
    }
  });
});
