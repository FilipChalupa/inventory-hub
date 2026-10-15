import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestServer, type TestServer } from '../lib/test-server.js';
import type { UserRow } from '../db/schema.js';
import { createPersonalToken } from './connections.js';
import { MCP_DISPATCH_ROUTES } from './dispatch.js';
import { DESTRUCTIVE_TOOLS, IDEMPOTENT_TOOLS, MCP_TOOLS } from './tools.js';

let server: TestServer;
beforeEach(() => {
  server = setupTestServer();
});
afterEach(() => server.close());

async function rpc(token: string, body: unknown, sessionId?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return server.app.request('http://localhost:5173/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Opens an MCP session for `user` and returns a `call(tool, args)` helper. */
async function connect(user: UserRow, access: 'read' | 'read-write' = 'read-write') {
  const { token } = createPersonalToken(server.db, {
    user,
    name: 'test',
    access,
    expiresInDays: 30,
  });
  const init = await rpc(token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    },
  });
  expect(init.status).toBe(200);
  const sid = init.headers.get('mcp-session-id')!;
  let id = 1;
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = await rpc(
      token,
      { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } },
      sid,
    );
    const { result } = (await res.json()) as {
      result: { isError?: boolean; content: { text: string }[] };
    };
    return { isError: Boolean(result.isError), body: JSON.parse(result.content[0]!.text) };
  };
}

describe('MCP tool registry', () => {
  it('routes every tool to a router mounted on the dispatch app', () => {
    const prefixes = Object.keys(MCP_DISPATCH_ROUTES);
    const dummy = new Proxy({}, { get: () => 'x' }) as Record<string, unknown>;
    for (const t of MCP_TOOLS) {
      const { path } = t.build(dummy);
      expect(
        prefixes.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?')),
        `${t.name} → ${path}`,
      ).toBe(true);
    }
  });

  it('get_stats and get_notifications answer', async () => {
    const call = await connect(server.createUser({ role: 'admin' }));
    const stats = await call('get_stats');
    expect(stats.isError).toBe(false);
    expect(stats.body).toHaveProperty('totalActive');
    const feed = await call('get_notifications');
    expect(feed.isError).toBe(false);
  });

  it('auditors stay read-only even on a read-write connection', async () => {
    const call = await connect(server.createUser({ role: 'auditor' }));
    const res = await call('create_location', { name: 'Sklad' });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.body)).toContain('Auditor');
  });

  it('runs an inventory session end to end', async () => {
    const call = await connect(server.createUser({ role: 'operator' }));
    const asset = await call('create_asset', { name: 'Laptop', typeId: server.laptopTypeId });
    expect(asset.isError).toBe(false);
    const code = asset.body.code as string;

    const created = await call('create_inventory', { name: 'Q4', assetCodes: [code] });
    expect(created.isError).toBe(false);
    const id = created.body.session.id as string;

    expect((await call('scan_inventory_item', { id, code })).isError).toBe(false);
    const report = await call('get_inventory', { id });
    expect(report.body.report.found).toHaveLength(1);
    const capped = await call('get_inventory', { id, maxPerList: 0 });
    expect(capped.body.report.found).toHaveLength(0);
    expect(capped.body.omitted).toEqual({ found: 1 });
    expect((await call('close_inventory', { id })).isError).toBe(false);
    const list = await call('list_inventories');
    expect(list.body.items[0]).toMatchObject({ id, status: 'closed' });
  });
});

describe('MCP response size + hints', () => {
  it('pages list_assets with compact rows', async () => {
    const call = await connect(server.createUser({ role: 'admin' }));
    for (let i = 0; i < 3; i++) {
      await call('create_asset', {
        name: `Kit ${i}`,
        typeId: server.laptopTypeId,
        notes: 'x'.repeat(500),
      });
    }
    const first = await call('list_assets', { limit: 2 });
    expect(first.body).toMatchObject({ total: 3, returned: 2, offset: 0, nextOffset: 2 });
    expect(Object.keys(first.body.items[0]).sort()).toEqual(
      ['assignedToUserId', 'code', 'locationId', 'name', 'status', 'typeId', 'url'].sort(),
    );
    const rest = await call('list_assets', { limit: 2, offset: 2 });
    expect(rest.body).toMatchObject({ returned: 1, nextOffset: null });
  });

  it('flattens router errors into { error, status }', async () => {
    const call = await connect(server.createUser({ role: 'admin' }));
    const res = await call('get_asset', { code: 'NOPE-1' });
    expect(res.isError).toBe(true);
    expect(res.body).toMatchObject({ status: 404 });
    expect(typeof res.body.error).toBe('string');
  });

  it('annotates destructive and idempotent tools', async () => {
    for (const name of [...DESTRUCTIVE_TOOLS, ...IDEMPOTENT_TOOLS]) {
      expect(
        MCP_TOOLS.some((t) => t.name === name && t.access === 'write'),
        name,
      ).toBe(true);
    }
    const { token } = createPersonalToken(server.db, {
      user: server.createUser(),
      name: 't',
      access: 'read',
      expiresInDays: 30,
    });
    const init = await rpc(token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
    });
    const list = await rpc(
      token,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      init.headers.get('mcp-session-id')!,
    );
    const tools = ((await list.json()) as any).result.tools as any[];
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    expect(byName.get('delete_contact')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(byName.get('scan_inventory_item')).toMatchObject({
      idempotentHint: true,
      destructiveHint: false,
    });
    expect(byName.get('list_assets')).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });
});
