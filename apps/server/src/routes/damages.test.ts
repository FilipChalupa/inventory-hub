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

  it('lets a member report a damage but not resolve it', async () => {
    const code = await makeAsset(server, cookie);
    const memberCookie = server.loginAs(
      server.createUser({ role: 'member', email: 'member@example.com' }),
    );

    // Reporting a fault is open to any authenticated user (a plain member).
    const created = await jsonPost(server, memberCookie, `/api/damages/by-asset/${code}`, {
      occurredAt: new Date().toISOString(),
      description: 'Reported by a member',
      severity: 'minor',
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // Resolving it is an operator/admin action — a member is rejected.
    const resolve = await jsonPost(server, memberCookie, `/api/damages/${id}/resolve`, {});
    expect(resolve.status).toBe(403);
  });

  it("a member's 'total' report does not archive the asset, but an admin's does", async () => {
    const code = await makeAsset(server, cookie);
    const memberCookie = server.loginAs(
      server.createUser({ role: 'member', email: 'member2@example.com' }),
    );

    // Member files a total-damage report: recorded, but must NOT soft-delete
    // the asset (would be a privilege escalation).
    const byMember = await jsonPost(server, memberCookie, `/api/damages/by-asset/${code}`, {
      occurredAt: new Date().toISOString(),
      description: 'total by member',
      severity: 'total',
    });
    expect(byMember.status).toBe(201);
    let row = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
    expect(row.archivedAt).toBeNull();
    expect(row.status).not.toBe('damaged');

    // An operator/admin filing the same does archive it.
    await jsonPost(server, cookie, `/api/damages/by-asset/${code}`, {
      occurredAt: new Date().toISOString(),
      description: 'total by admin',
      severity: 'total',
    });
    row = server.db.select().from(assets).where(eq(assets.code, code)).get()!;
    expect(row.archivedAt).not.toBeNull();
    expect(row.status).toBe('damaged');
  });
});
