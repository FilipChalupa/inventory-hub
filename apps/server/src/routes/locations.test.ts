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

  describe('import CSV', () => {
    async function importCsv(text: string, dryRun: boolean, who = cookie) {
      const form = new FormData();
      form.append('file', new File([text], 'locs.csv', { type: 'text/csv' }));
      form.append('dryRun', dryRun ? 'true' : 'false');
      return server.authRequest('/api/locations/import', {
        cookie: who,
        method: 'POST',
        body: form,
      });
    }

    it('commits new locations and resolves parent_name to existing rows', async () => {
      await createLocation('Budova A');
      const res = await importCsv(
        'name,parent_name\r\n1.NP,Budova A\r\nKancelář,Budova A\r\n',
        false,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { created: number };
      expect(body.created).toBe(2);
      const all = server.db.select().from(locations).all();
      expect(all.map((l) => l.name).sort()).toEqual(['1.NP', 'Budova A', 'Kancelář']);
      const child = all.find((l) => l.name === '1.NP')!;
      const root = all.find((l) => l.name === 'Budova A')!;
      expect(child.parentId).toBe(root.id);
    });

    it('rejects when parent_name does not exist', async () => {
      const res = await importCsv('name,parent_name\r\nA,Nonexistent\r\n', true);
      const body = (await res.json()) as { preview: { issues: string[] }[]; hasErrors: boolean };
      expect(body.hasErrors).toBe(true);
      expect(body.preview[0]!.issues.some((s) => /neexistuje/.test(s))).toBe(true);
    });

    it('member is forbidden from import', async () => {
      const memberCookie = server.loginAs(
        server.createUser({ role: 'member', email: 'm@example.com' }),
      );
      const res = await importCsv('name\r\nX\r\n', false, memberCookie);
      expect(res.status).toBe(403);
    });
  });
});
