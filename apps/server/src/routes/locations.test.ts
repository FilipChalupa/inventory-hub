import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { locations } from '../db/schema.js';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

async function jsonPost(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function jsonPatch(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('locations API', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  async function createLocation(name: string, parentId: string | null = null): Promise<string> {
    const res = await jsonPost(server, cookie, '/api/locations', { name, parentId });
    return ((await res.json()) as { id: string }).id;
  }

  it('reparents a location to a new parent', async () => {
    const a = await createLocation('A');
    const b = await createLocation('B');
    const res = await jsonPatch(server, cookie, `/api/locations/${b}`, { parentId: a });
    expect(res.status).toBe(200);
    const row = server.db.select().from(locations).where(eq(locations.id, b)).get()!;
    expect(row.parentId).toBe(a);
  });

  it('rejects a move that would parent a node under itself', async () => {
    const a = await createLocation('A');
    const res = await jsonPatch(server, cookie, `/api/locations/${a}`, { parentId: a });
    expect(res.status).toBe(409);
  });

  it('rejects a move that would parent a node under one of its descendants', async () => {
    const a = await createLocation('A');
    const b = await createLocation('B', a);
    const c = await createLocation('C', b);
    // A → C (descendant) would form a cycle A→C→B→A
    const res = await jsonPatch(server, cookie, `/api/locations/${a}`, { parentId: c });
    expect(res.status).toBe(409);
  });

  it('rejects when the target parent does not exist', async () => {
    const a = await createLocation('A');
    const res = await jsonPatch(server, cookie, `/api/locations/${a}`, {
      parentId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(400);
  });

  it('allows moving back to root (parentId null)', async () => {
    const a = await createLocation('A');
    const b = await createLocation('B', a);
    const res = await jsonPatch(server, cookie, `/api/locations/${b}`, { parentId: null });
    expect(res.status).toBe(200);
    const row = server.db.select().from(locations).where(eq(locations.id, b)).get()!;
    expect(row.parentId).toBeNull();
  });
});
