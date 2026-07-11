import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { loans, users } from '../db/schema.js';
import { pruneOldAuditEvents } from './retention.js';
import { assetEvents } from '../db/schema.js';
import { setupTestServer, type TestServer } from './test-server.js';

async function jsonPost(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GDPR compliance', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  async function setupMemberWithData() {
    const member = server.createUser({
      role: 'member',
      email: 'subject@example.com',
      name: 'Jan Subjekt',
    });
    const asset = (await jsonPost(server, cookie, '/api/assets', {
      name: 'Borrowed',
      typeId: server.laptopTypeId,
    }).then((r) => r.json())) as { code: string };
    await jsonPost(server, cookie, '/api/loans', {
      borrowerName: 'Jan Subjekt',
      borrowerUserId: member.id,
      assetCodes: [asset.code],
    });
    return member;
  }

  it('exports a user data bundle (admin only)', async () => {
    const member = await setupMemberWithData();

    const forbidden = await server.authRequest(`/api/users/${member.id}/export`, {
      cookie: server.loginAs(server.createUser({ role: 'operator', email: 'op@example.com' })),
    });
    expect(forbidden.status).toBe(403);

    const res = await server.authRequest(`/api/users/${member.id}/export`, { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { email: string };
      loansAsBorrower: unknown[];
    };
    expect(body.user.email).toBe('subject@example.com');
    expect(body.loansAsBorrower).toHaveLength(1);
  });

  it('anonymizes a user in place and revokes access', async () => {
    const member = await setupMemberWithData();
    const memberCookie = server.loginAs(
      server.db.select().from(users).where(eq(users.id, member.id)).get()!,
    );

    const res = await jsonPost(server, cookie, `/api/users/${member.id}/anonymize`, {});
    expect(res.status).toBe(200);

    const row = server.db.select().from(users).where(eq(users.id, member.id)).get()!;
    expect(row.name).toBe('Anonymizovaný uživatel');
    expect(row.email).toContain('@anonymized.invalid');
    expect(row.disabledAt).not.toBeNull();

    // Borrower-name snapshot on their loan is scrubbed.
    const loan = server.db.select().from(loans).where(eq(loans.borrowerUserId, member.id)).get()!;
    expect(loan.borrowerName).toBe('Anonymizovaný uživatel');

    // Their session is gone → they're logged out.
    const me = await server.authRequest('/api/users', { cookie: memberCookie });
    expect(me.status).toBe(401);
  });

  it('refuses to anonymize yourself', async () => {
    const admin = server.createUser({ role: 'admin', email: 'boss@example.com' });
    const adminCookie = server.loginAs(admin);
    const res = await jsonPost(server, adminCookie, `/api/users/${admin.id}/anonymize`, {});
    expect(res.status).toBe(400);
  });

  it('pruneOldAuditEvents deletes events older than the retention window', async () => {
    await jsonPost(server, cookie, '/api/assets', { name: 'X', typeId: server.laptopTypeId });
    // Backdate the created event well past the window.
    server.db
      .update(assetEvents)
      .set({ occurredAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) })
      .run();

    const removed = pruneOldAuditEvents(server.db, 365);
    expect(removed).toBeGreaterThan(0);
    expect(pruneOldAuditEvents(server.db, 0)).toBe(0);
  });
});
