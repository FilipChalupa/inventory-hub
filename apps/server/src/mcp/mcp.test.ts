import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestServer, type TestServer } from '../lib/test-server.js';
import { issueTokens } from './oauth-store.js';

let server: TestServer;
beforeEach(() => {
  server = setupTestServer();
});
afterEach(() => server.close());

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function registerClient(redirectUri = 'http://localhost:8123/callback') {
  const res = await server.app.request('http://localhost:5173/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: 'Test MCP Client' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { client_id: string };
}

/** Runs the full authorize → consent → token exchange and returns the access token. */
async function obtainToken(grant: 'read' | 'read-write') {
  const { client_id } = await registerClient();
  const { verifier, challenge } = pkcePair();
  const user = server.createUser({ role: 'admin' });
  const cookie = server.loginAs(user);

  const authorizeQs = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: 'http://localhost:8123/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: 'http://localhost:5173/mcp',
  });
  const consentRes = await server.app.request(`http://localhost:5173/authorize?${authorizeQs}`, {
    headers: { Cookie: cookie },
  });
  expect(consentRes.status).toBe(200);
  expect(await consentRes.text()).toContain('Připojit');

  const form = new URLSearchParams({
    client_id,
    redirect_uri: 'http://localhost:8123/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: 'http://localhost:5173/mcp',
    grant,
    decision: 'approve',
  });
  const consentPost = await server.app.request('http://localhost:5173/authorize/consent', {
    method: 'POST',
    headers: { Cookie: cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual',
  });
  expect(consentPost.status).toBe(302);
  const location = consentPost.headers.get('location')!;
  const code = new URL(location).searchParams.get('code')!;
  expect(code).toBeTruthy();

  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: 'http://localhost:8123/callback',
    client_id,
  });
  const tokenRes = await server.app.request('http://localhost:5173/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenForm.toString(),
  });
  expect(tokenRes.status).toBe(200);
  const tokens = (await tokenRes.json()) as { access_token: string; scope: string };
  return { token: tokens.access_token, scope: tokens.scope, user };
}

async function mcp(token: string | null, body: unknown, sessionId?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return server.app.request('http://localhost:5173/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Initialize a session and return its mcp-session-id. */
async function initSession(token: string): Promise<string> {
  const res = await mcp(token, INIT);
  expect(res.status).toBe(200);
  return res.headers.get('mcp-session-id')!;
}

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

async function readJsonRpc(res: Response): Promise<any> {
  const text = await res.text();
  // enableJsonResponse → application/json; but be defensive about SSE framing.
  if (text.startsWith('event:') || text.includes('\ndata:')) {
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    return line ? JSON.parse(line.slice(5).trim()) : undefined;
  }
  return JSON.parse(text);
}

describe('MCP OAuth discovery', () => {
  it('serves protected resource metadata', async () => {
    const res = await server.app.request(
      'http://localhost:5173/.well-known/oauth-protected-resource',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.resource).toBe('http://localhost:5173/mcp');
    expect(body.authorization_servers).toContain('http://localhost:5173');
  });

  it('serves authorization server metadata', async () => {
    const res = await server.app.request(
      'http://localhost:5173/.well-known/oauth-authorization-server',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.token_endpoint).toBe('http://localhost:5173/token');
    expect(body.code_challenge_methods_supported).toContain('S256');
  });
});

describe('MCP bearer protection', () => {
  it('returns 401 + WWW-Authenticate without a token', async () => {
    const res = await mcp(null, INIT);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('rejects a token issued for a different audience', async () => {
    const user = server.createUser({ role: 'admin' });
    const { client_id } = await registerClient();
    const { accessToken } = issueTokens(server.db, {
      clientId: client_id,
      userId: user.id,
      scope: 'mcp:read mcp:write',
      audience: 'https://evil.example/mcp',
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    });
    const res = await mcp(accessToken, INIT);
    expect(res.status).toBe(401);
  });
});

describe('MCP full flow', () => {
  it('completes OAuth and lists + calls tools', async () => {
    const { token } = await obtainToken('read-write');
    const sid = await initSession(token);

    const listRes = await mcp(
      token,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      sid,
    );
    const list = await readJsonRpc(listRes);
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain('list_assets');
    expect(names).toContain('create_loan');

    const callRes = await mcp(
      token,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_assets', arguments: {} },
      },
      sid,
    );
    const call = await readJsonRpc(callRes);
    expect(call.result.isError).toBeFalsy();
    expect(call.result.content[0].type).toBe('text');
  });

  it('blocks write tools on a read-only grant', async () => {
    const { token, scope } = await obtainToken('read');
    expect(scope).toBe('mcp:read');
    const sid = await initSession(token);
    const callRes = await mcp(
      token,
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'create_location', arguments: { name: 'Sklad' } },
      },
      sid,
    );
    const call = await readJsonRpc(callRes);
    expect(call.result.isError).toBe(true);
    expect(JSON.stringify(call.result.content)).toContain('read-only');
  });

  it('enforces role downstream (member cannot list users)', async () => {
    const { client_id } = await registerClient();
    const member = server.createUser({ role: 'member' });
    const { accessToken } = issueTokens(server.db, {
      clientId: client_id,
      userId: member.id,
      scope: 'mcp:read mcp:write',
      audience: 'http://localhost:5173/mcp',
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    });
    const sid = await initSession(accessToken);
    const callRes = await mcp(
      accessToken,
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'list_users', arguments: {} },
      },
      sid,
    );
    const call = await readJsonRpc(callRes);
    expect(call.result.isError).toBe(true);
  });
});
