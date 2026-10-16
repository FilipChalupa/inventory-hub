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
    // Refused before reaching the routers (whose auditor guard is the backstop).
    expect(JSON.stringify(res.body)).toMatch(/read-only|Auditor/);
  });

  it('runs an inventory session end to end', async () => {
    const call = await connect(server.createUser({ role: 'operator' }));
    const asset = await call('create_asset', { name: 'Laptop', typeId: server.laptopTypeId });
    expect(asset.isError).toBe(false);
    const code = asset.body.code as string;

    const created = await call('create_inventory', { name: 'Q4', assetCodes: [code] });
    expect(created.isError).toBe(false);
    const id = created.body.session.id as string;

    await call('add_asset_external_id', { code, kind: 'serial', value: 'SN-INV-1' });
    // Scanning the manufacturer serial resolves to the asset.
    const bySerial = await call('scan_inventory_item', { id, code: 'sn inv 1' });
    expect(bySerial.isError).toBe(false);
    expect(bySerial.body).toMatchObject({ result: 'found', asset: { code } });
    expect((await call('scan_inventory_item', { id, code })).body.result).toBe('already');
    expect((await call('scan_inventory_item', { id, code: 'NOPE-404' })).body.status).toBe(404);
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

// 1×1 transparent PNG.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('MCP photos', () => {
  async function connectRaw(user: UserRow) {
    const { token } = createPersonalToken(server.db, {
      user,
      name: 'cam',
      access: 'read-write',
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
    const sid = init.headers.get('mcp-session-id')!;
    let id = 1;
    return async (name: string, args: Record<string, unknown>) => {
      const res = await rpc(
        token,
        { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } },
        sid,
      );
      return ((await res.json()) as any).result as {
        isError?: boolean;
        content: { type: string; text?: string; data?: string; mimeType?: string }[];
      };
    };
  }

  it('attaches a base64 photo, then returns it as an image', async () => {
    const op = server.createUser({ role: 'operator' });
    const call = await connect(op);
    const raw = await connectRaw(op);
    const { code } = (await call('create_asset', { name: 'Cam', typeId: server.laptopTypeId }))
      .body;

    const added = await call('add_asset_photo', {
      code,
      imageBase64: `data:image/png;base64,${PNG_1PX}`,
    });
    expect(added.isError).toBe(false);
    expect(added.body.photoPaths).toHaveLength(1);

    const photo = await raw('get_asset_photo', { code });
    expect(photo.isError).toBeFalsy();
    const img = photo.content.find((c) => c.type === 'image')!;
    expect(img).toMatchObject({ mimeType: 'image/png', data: PNG_1PX });

    const missing = await call('get_asset_photo', { code, index: 5 });
    expect(missing.isError).toBe(true);

    const removed = await call('remove_asset_photo', { code, path: added.body.photoPaths[0] });
    expect(removed.body.photoPaths).toEqual([]);
  });

  it('rejects private URLs, non-images and ambiguous input', async () => {
    const call = await connect(server.createUser({ role: 'operator' }));
    const { code } = (await call('create_asset', { name: 'Cam', typeId: server.laptopTypeId }))
      .body;

    const ssrf = await call('add_asset_photo', {
      code,
      imageUrl: 'http://127.0.0.1:3001/secret.png',
    });
    expect(ssrf.isError).toBe(true);
    expect(ssrf.body.status).toBe(422);

    const pdf = await call('add_asset_photo', {
      code,
      imageBase64: Buffer.from('%PDF-1.4 fake').toString('base64'),
    });
    expect(pdf.isError).toBe(true);
    expect(pdf.body.status).toBe(415);

    const both = await call('add_asset_photo', {
      code,
      imageBase64: PNG_1PX,
      imageUrl: 'https://x.y/a.png',
    });
    expect(both.isError).toBe(true);
  });

  it('a member reports damage with a photo but cannot attach asset photos', async () => {
    const op = await connect(server.createUser({ role: 'operator' }));
    const { code } = (await op('create_asset', { name: 'Cam', typeId: server.laptopTypeId })).body;
    const member = await connect(server.createUser({ role: 'member' }));

    const report = await member('report_damage', {
      code,
      occurredAt: new Date().toISOString(),
      description: 'Cracked screen',
      severity: 'minor',
      photos: [{ imageBase64: PNG_1PX }],
    });
    expect(report.isError).toBe(false);
    const damages = await member('list_asset_damages', { code });
    expect(damages.body.items[0].photoPaths).toHaveLength(1);

    const denied = await member('add_asset_photo', { code, imageBase64: PNG_1PX });
    expect(denied.isError).toBe(true);
    expect(denied.body.status).toBe(403);
  });
});

describe('identifier lookup', () => {
  it('finds assets by serial, code or custom field — exact, separator-insensitive', async () => {
    const call = await connect(server.createUser({ role: 'operator' }));
    const a = (await call('create_asset', { name: 'ThinkPad', typeId: server.laptopTypeId })).body;
    const b = (await call('create_asset', { name: 'Other', typeId: server.laptopTypeId })).body;
    expect(
      (await call('add_asset_external_id', { code: a.code, kind: 'serial', value: 'PF-3AB12' }))
        .isError,
    ).toBe(false);
    await call('add_asset_external_id', { code: b.code, kind: 'serial', value: 'PF3AB123' });

    const bySerial = await call('find_asset_by_identifier', { value: 'pf 3ab12' });
    expect(bySerial.body.items).toHaveLength(1);
    expect(bySerial.body.items[0]).toMatchObject({
      code: a.code,
      matchedOn: [{ field: 'externalId', key: 'serial', value: 'PF-3AB12', exact: false }],
    });
    expect(bySerial.body.items[0].url).toContain(`/a/${a.code}`);

    const byCode = await call('find_asset_by_identifier', { value: a.code.toLowerCase() });
    expect(byCode.body.items[0].matchedOn[0]).toMatchObject({ field: 'code' });

    // Restricting the kind skips other kinds and codes.
    const wrongKind = await call('find_asset_by_identifier', { value: 'PF-3AB12', kind: 'ean' });
    expect(wrongKind.body.items).toEqual([]);

    // Substring search via list_assets still finds both.
    const fuzzy = await call('list_assets', { q: 'PF3AB12' });
    expect(fuzzy.body.total).toBe(1); // only exact substring "PF3AB12" (b); a has a dash
  });

  it('matches custom-field values', async () => {
    const call = await connect(server.createUser({ role: 'admin' }));
    const db = server.db;
    const a = (await call('create_asset', { name: 'Mon', typeId: server.laptopTypeId })).body;
    const { assets } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    db.update(assets)
      .set({ customFields: { inventoryNo: 'INV/2024/007' } })
      .where(eq(assets.code, a.code))
      .run();
    const res = await call('find_asset_by_identifier', { value: 'inv-2024-007' });
    expect(res.body.items[0]).toMatchObject({
      code: a.code,
      matchedOn: [{ field: 'customField', key: 'inventoryNo', value: 'INV/2024/007' }],
    });
  });

  it('manages external ids and rejects duplicates', async () => {
    const call = await connect(server.createUser({ role: 'operator' }));
    const a = (await call('create_asset', { name: 'X', typeId: server.laptopTypeId })).body;
    const b = (await call('create_asset', { name: 'Y', typeId: server.laptopTypeId })).body;
    await call('add_asset_external_id', { code: a.code, kind: 'ean', value: '8590000000001' });
    const dup = await call('add_asset_external_id', {
      code: b.code,
      kind: 'ean',
      value: '8590000000001',
    });
    expect(dup.isError).toBe(true);
    expect(dup.body.status).toBe(409);
    const list = await call('list_asset_external_ids', { code: a.code });
    const id = list.body.items[0].id;
    expect((await call('remove_asset_external_id', { code: a.code, id })).isError).toBe(false);
    expect((await call('list_asset_external_ids', { code: a.code })).body.items).toEqual([]);
  });
});

describe('upload links', () => {
  async function uploadTo(url: string, bytes: Buffer, name = 'f.png') {
    const form = new FormData();
    form.append('file', new File([bytes], name));
    // No cookie, no Origin — exactly what curl sends.
    return server.app.request(url, { method: 'POST', body: form });
  }
  const png = () => Buffer.from(PNG_1PX, 'base64');

  it('uploads a photo once and attaches it to the asset as the agent', async () => {
    const call = await connect(server.createUser({ role: 'operator' }));
    const { code } = (await call('create_asset', { name: 'Cam', typeId: server.laptopTypeId }))
      .body;
    const link = await call('create_upload_link', { purpose: 'asset_photo', code });
    expect(link.isError).toBe(false);
    expect(link.body.uploadUrl).toMatch(/^http:\/\/localhost:5173\/upload\/[\w-]+$/);
    expect(link.body.command).toContain('curl');

    const res = await uploadTo(link.body.uploadUrl, png());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attachedTo: string; photoPaths: string[] };
    expect(body.attachedTo).toBe(code);
    expect(body.photoPaths).toHaveLength(1);

    // Single use.
    expect((await uploadTo(link.body.uploadUrl, png())).status).toBe(404);

    const events = await call('get_asset_events', { code });
    expect(events.body.items.find((e: any) => e.payload?.photo)).toMatchObject({ via: 'test' });
  });

  it('stores a damage photo and lets report_damage use the path', async () => {
    const call = await connect(server.createUser({ role: 'member' }));
    const op = await connect(server.createUser({ role: 'operator' }));
    const { code } = (await op('create_asset', { name: 'Cam', typeId: server.laptopTypeId })).body;
    const link = await call('create_upload_link', { purpose: 'damage_photo' });
    const res = await uploadTo(link.body.uploadUrl, png());
    const { path } = (await res.json()) as { path: string };
    const report = await call('report_damage', {
      code,
      occurredAt: new Date().toISOString(),
      description: 'dent',
      severity: 'minor',
      photos: [{ uploadedPath: path }],
    });
    expect(report.isError).toBe(false);
  });

  it('refuses members for asset files, non-images for photos, and bad tokens', async () => {
    const member = await connect(server.createUser({ role: 'member' }));
    const op = await connect(server.createUser({ role: 'operator' }));
    const { code } = (await op('create_asset', { name: 'Cam', typeId: server.laptopTypeId })).body;
    const denied = await member('create_upload_link', { purpose: 'asset_photo', code });
    expect(denied.body.status).toBe(403);

    const link = await op('create_upload_link', { purpose: 'asset_photo', code });
    const pdf = await uploadTo(link.body.uploadUrl, Buffer.from('%PDF-1.4 x'), 'a.pdf');
    expect(pdf.status).toBe(415);
    // A failed attempt doesn't burn the link.
    expect((await uploadTo(link.body.uploadUrl, png())).status).toBe(200);

    const docLink = await op('create_upload_link', { purpose: 'asset_document', code });
    expect(
      (await uploadTo(docLink.body.uploadUrl, Buffer.from('%PDF-1.4 x'), 'a.pdf')).status,
    ).toBe(200);

    expect((await uploadTo('http://localhost:5173/upload/nope', png())).status).toBe(404);
    const missing = await op('create_upload_link', { purpose: 'asset_photo', code: 'NOPE-1' });
    expect(missing.body.status).toBe(404);
  });

  it('read-only connections cannot mint links', async () => {
    const call = await connect(server.createUser({ role: 'admin' }), 'read');
    const res = await call('create_upload_link', { purpose: 'damage_photo' });
    expect(res.isError).toBe(true);
  });
});

describe('bulk identifiers', () => {
  it('applies valid items and reports the rest', async () => {
    const call = await connect(server.createUser({ role: 'operator' }));
    const a = (await call('create_asset', { name: 'A', typeId: server.laptopTypeId })).body.code;
    const b = (await call('create_asset', { name: 'B', typeId: server.laptopTypeId })).body.code;
    await call('add_asset_external_id', { code: b, kind: 'serial', value: 'OWNED' });
    await call('add_asset_external_id', { code: b, kind: 'ean', value: 'MINE' });
    const items = [
      { code: a.toLowerCase(), kind: 'serial', value: 'S-1' },
      { code: a, kind: 'serial', value: 'S-1' },
      { code: a, kind: 'serial', value: 'OWNED' },
      { code: 'NOPE-1', kind: 'serial', value: 'S-2' },
      { code: b, kind: 'ean', value: 'MINE' },
    ];
    const dry = await call('bulk_add_external_ids', { items, dryRun: true });
    expect(dry.body.summary.added).toBe(1);
    expect((await call('find_asset_by_identifier', { value: 'S-1' })).body.items).toEqual([]);

    const res = await call('bulk_add_external_ids', { items });
    expect(res.body.summary).toEqual({
      added: 1,
      already: 1,
      conflict: 1,
      asset_not_found: 1,
      duplicate_in_request: 1,
    });
    expect(res.body.problems.map((p: any) => p.result).sort()).toEqual([
      'asset_not_found',
      'conflict',
      'duplicate_in_request',
    ]);
    expect((await call('find_asset_by_identifier', { value: 's1' })).body.items[0].code).toBe(a);
  });
});

describe('org MCP policy', () => {
  async function setPolicy(cookie: string, policy: Record<string, unknown>) {
    const res = await server.authRequest('/api/mcp-connections/policy', {
      method: 'PUT',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(policy),
    });
    return res;
  }

  it('only admins change it; everyone can read it', async () => {
    const member = server.loginAs(server.createUser({ role: 'member' }));
    expect((await setPolicy(member, { enabled: false })).status).toBe(403);
    const get = await server.authRequest('/api/mcp-connections/policy', { cookie: member });
    expect(await get.json()).toEqual({
      enabled: true,
      writeRoles: ['admin', 'operator', 'member'],
      maxTokenDays: null,
    });
  });

  it('disabling MCP cuts live connections and token creation', async () => {
    const admin = server.createUser({ role: 'admin' });
    const cookie = server.loginAs(admin);
    const call = await connect(admin);
    expect((await call('get_stats')).isError).toBe(false);

    expect((await setPolicy(cookie, { enabled: false })).status).toBe(200);
    const res = await rpc(
      createPersonalToken(server.db, { user: admin, name: 'x', access: 'read', expiresInDays: 30 })
        .token,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '1' },
        },
      },
    );
    expect(res.status).toBe(403);
    const token = await server.authRequest('/api/mcp-connections/tokens', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'n' }),
    });
    expect(token.status).toBe(403);
  });

  it('write roles and max token lifetime are enforced', async () => {
    const admin = server.loginAs(server.createUser({ role: 'admin' }));
    await setPolicy(admin, { enabled: true, writeRoles: ['admin'], maxTokenDays: 90 });

    const op = server.createUser({ role: 'operator' });
    const call = await connect(op); // connection itself was read-write
    const write = await call('create_location', { name: 'Sklad' });
    expect(write.isError).toBe(true);
    expect(JSON.stringify(write.body)).toContain('read-only for your role');
    expect((await call('list_locations')).isError).toBe(false);

    const opCookie = server.loginAs(op);
    const mint = (body: Record<string, unknown>) =>
      server.authRequest('/api/mcp-connections/tokens', {
        method: 'POST',
        cookie: opCookie,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'n', ...body }),
      });
    expect((await mint({ access: 'read-write', expiresInDays: 30 })).status).toBe(403);
    expect((await mint({ access: 'read', expiresInDays: 365 })).status).toBe(400);
    expect((await mint({ access: 'read', expiresInDays: null })).status).toBe(400);
    expect((await mint({ access: 'read', expiresInDays: 90 })).status).toBe(201);
  });
});
