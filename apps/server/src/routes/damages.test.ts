import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { MAX_DAMAGE_PHOTOS } from '@inventory-hub/shared';
import { assets, damageReports } from '../db/schema.js';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

async function jsonPost(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function makeAsset(server: TestServer, cookie: string) {
  const r = await jsonPost(server, cookie, '/api/assets', {
    name: 'A',
    typeId: server.laptopTypeId,
  });
  return ((await r.json()) as { code: string }).code;
}

describe('damages API', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  it('creates a damage report with photos up to the limit', async () => {
    const code = await makeAsset(server, cookie);
    const photos = Array.from({ length: MAX_DAMAGE_PHOTOS }, (_, i) => `photo-${i}.jpg`);
    const res = await jsonPost(server, cookie, `/api/damages/by-asset/${code}`, {
      occurredAt: new Date().toISOString(),
      description: 'Praskla obrazovka',
      severity: 'minor',
      photoPaths: photos,
    });
    expect(res.status).toBe(201);
  });

  it('rejects more than MAX_DAMAGE_PHOTOS attachments', async () => {
    const code = await makeAsset(server, cookie);
    const tooMany = Array.from({ length: MAX_DAMAGE_PHOTOS + 1 }, (_, i) => `p-${i}.jpg`);
    const res = await jsonPost(server, cookie, `/api/damages/by-asset/${code}`, {
      occurredAt: new Date().toISOString(),
      description: 'too many',
      severity: 'minor',
      photoPaths: tooMany,
    });
    expect(res.status).toBe(400);
  });

  it('total severity auto-archives the asset as damaged', async () => {
    const code = await makeAsset(server, cookie);
    const res = await jsonPost(server, cookie, `/api/damages/by-asset/${code}`, {
      occurredAt: new Date().toISOString(),
      description: 'Naprostý nepořádek',
      severity: 'total',
    });
    expect(res.status).toBe(201);
    const row = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
    expect(row.status).toBe('damaged');
    expect(row.archivedAt).not.toBeNull();
    const reports = server.db
      .select()
      .from(damageReports)
      .where(eq(damageReports.assetId, row.id))
      .all();
    expect(reports).toHaveLength(1);
  });

  it('resolves a damage report', async () => {
    const code = await makeAsset(server, cookie);
    const created = await jsonPost(server, cookie, `/api/damages/by-asset/${code}`, {
      occurredAt: new Date().toISOString(),
      description: 'minor',
      severity: 'minor',
    });
    const { id } = (await created.json()) as { id: string };
    const res = await jsonPost(server, cookie, `/api/damages/${id}/resolve`, {});
    expect(res.status).toBe(200);
    const row = server.db.select().from(damageReports).where(eq(damageReports.id, id)).get()!;
    expect(row.resolvedAt).not.toBeNull();
  });
});
