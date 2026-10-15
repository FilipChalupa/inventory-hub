import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestServer, type TestServer } from '../lib/test-server.js';
import { issueTokens, registerClient } from '../mcp/oauth-store.js';

let server: TestServer;
beforeEach(() => {
  server = setupTestServer();
});
afterEach(() => server.close());

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 't', version: '1' },
  },
};

function mcpInit(token: string) {
  return server.app.request('http://localhost:5173/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(INIT),
  });
}

function createToken(cookie: string, body: Record<string, unknown>) {
  return server.authRequest('/api/mcp-connections/tokens', {
    method: 'POST',
    cookie,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function connectOauth(userId: string, clientName = 'Claude') {
  const { client } = registerClient(server.db, {
    redirectUris: ['http://localhost:8123/callback'],
    clientName,
  });
  const tokens = issueTokens(server.db, {
    clientId: client.id,
    userId,
    scope: 'mcp:read mcp:write',
    audience: 'http://localhost:5173/mcp',
    accessTtlSeconds: 3600,
    refreshTtlSeconds: 3600,
  });
  return { clientId: client.id, ...tokens };
}

describe('personal MCP tokens', () => {
  it('any role can mint a token that authenticates /mcp, then revoke it', async () => {
    const member = server.createUser({ role: 'member' });
    const cookie = server.loginAs(member);

    const res = await createToken(cookie, { name: 'n8n', access: 'read', expiresInDays: null });
    expect(res.status).toBe(201);
    const created = (await res.json()) as any;
    expect(created.token).toMatch(/^ihm_/);
    expect(created.access).toBe('read');
    expect(created.expiresAt).toBeNull();

    expect((await mcpInit(created.token)).status).toBe(200);

    const list = (await (
      await server.authRequest('/api/mcp-connections', { cookie })
    ).json()) as any;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'personal', name: 'n8n', id: created.id });
    expect(list.items[0].lastUsedAt).not.toBeNull();
    expect(list.items[0].token).toBeUndefined();

    const del = await server.authRequest(`/api/mcp-connections/tokens/${created.id}`, {
      method: 'DELETE',
      cookie,
    });
    expect(del.status).toBe(200);
    expect((await mcpInit(created.token)).status).toBe(401);
  });

  it('rejects an expiry outside the presets', async () => {
    const cookie = server.loginAs(server.createUser());
    const res = await createToken(cookie, { name: 'x', expiresInDays: 7 });
    expect(res.status).toBe(400);
  });

  it("a member cannot revoke someone else's token", async () => {
    const alice = server.createUser({ role: 'member' });
    const bob = server.createUser({ role: 'member' });
    const created = (await (await createToken(server.loginAs(alice), { name: 'a' })).json()) as any;
    const res = await server.authRequest(`/api/mcp-connections/tokens/${created.id}`, {
      method: 'DELETE',
      cookie: server.loginAs(bob),
    });
    expect(res.status).toBe(404);
  });
});

describe('OAuth connections', () => {
  it('groups rotated rows per client and disconnects them', async () => {
    const user = server.createUser({ role: 'operator' });
    const cookie = server.loginAs(user);
    const { clientId, accessToken } = connectOauth(user.id, 'Claude Desktop');

    const list = (await (
      await server.authRequest('/api/mcp-connections', { cookie })
    ).json()) as any;
    expect(list.items).toEqual([
      expect.objectContaining({
        kind: 'oauth',
        id: clientId,
        name: 'Claude Desktop',
        access: 'read-write',
      }),
    ]);

    const del = await server.authRequest(`/api/mcp-connections/oauth/${clientId}`, {
      method: 'DELETE',
      cookie,
    });
    expect(del.status).toBe(200);
    expect((await mcpInit(accessToken)).status).toBe(401);
    const after = (await (
      await server.authRequest('/api/mcp-connections', { cookie })
    ).json()) as any;
    expect(after.items).toHaveLength(0);
  });

  it('only admins see and revoke the whole org', async () => {
    const admin = server.createUser({ role: 'admin' });
    const member = server.createUser({ role: 'member' });
    const { clientId } = connectOauth(member.id);
    const memberCookie = server.loginAs(member);
    const adminCookie = server.loginAs(admin);

    expect(
      (await server.authRequest('/api/mcp-connections?all=1', { cookie: memberCookie })).status,
    ).toBe(403);
    const forbidden = await server.authRequest(
      `/api/mcp-connections/oauth/${clientId}?userId=${admin.id}`,
      { method: 'DELETE', cookie: memberCookie },
    );
    expect(forbidden.status).toBe(403);

    const all = (await (
      await server.authRequest('/api/mcp-connections?all=1', { cookie: adminCookie })
    ).json()) as any;
    expect(all.items).toHaveLength(1);
    expect(all.items[0].user).toMatchObject({ id: member.id, email: member.email });

    const own = (await (
      await server.authRequest('/api/mcp-connections', { cookie: adminCookie })
    ).json()) as any;
    expect(own.items).toHaveLength(0);

    const del = await server.authRequest(
      `/api/mcp-connections/oauth/${clientId}?userId=${member.id}`,
      { method: 'DELETE', cookie: adminCookie },
    );
    expect(del.status).toBe(200);
  });
});

describe('tool catalogue', () => {
  it('lists every MCP tool with its access level', async () => {
    const cookie = server.loginAs(server.createUser({ role: 'member' }));
    const res = await server.authRequest('/api/mcp-connections/tools', { cookie });
    const body = (await res.json()) as { items: { name: string; access: string }[] };
    expect(body.items).toContainEqual(
      expect.objectContaining({ name: 'list_assets', access: 'read' }),
    );
    expect(body.items).toContainEqual(
      expect.objectContaining({ name: 'create_loan', access: 'write' }),
    );
  });
});
