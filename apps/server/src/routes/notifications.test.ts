import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { assets, damageReports, loanItems, loans, users } from '../db/schema.js';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

const DAY = 24 * 60 * 60 * 1000;

function makeAsset(server: TestServer, overrides: Partial<typeof assets.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  const code = `LAP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  server.db
    .insert(assets)
    .values({ id, code, name: 'Laptop', typeId: server.laptopTypeId, ...overrides })
    .run();
  return { id, code };
}

describe('notifications API', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  it('surfaces an overdue loan and an expiring warranty and counts them as unread', async () => {
    // Overdue loan: expected return in the past with one still-open item.
    const asset = makeAsset(server);
    const loanId = crypto.randomUUID();
    server.db
      .insert(loans)
      .values({
        id: loanId,
        borrowerName: 'Alice',
        expectedReturnAt: new Date(Date.now() - 2 * DAY),
        startedAt: new Date(Date.now() - 5 * DAY),
        createdByUserId: server.createUser({ email: 'creator@example.com' }).id,
      })
      .run();
    server.db
      .insert(loanItems)
      .values({ id: crypto.randomUUID(), loanId, assetId: asset.id })
      .run();

    // Asset with a warranty expiring within the window.
    makeAsset(server, { warrantyUntil: new Date(Date.now() + 10 * DAY) });

    const res = await server.authRequest('/api/notifications', { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; type: string; severity: string }[];
      unreadCount: number;
    };

    expect(body.items.some((i) => i.type === 'overdue_loan')).toBe(true);
    expect(body.items.some((i) => i.type === 'warranty')).toBe(true);
    expect(body.unreadCount).toBe(body.items.length);
    expect(body.unreadCount).toBeGreaterThanOrEqual(2);
  });

  it('drops unreadCount to zero after marking the feed seen', async () => {
    makeAsset(server, { warrantyUntil: new Date(Date.now() + 5 * DAY) });

    const before = (await (await server.authRequest('/api/notifications', { cookie })).json()) as {
      unreadCount: number;
    };
    expect(before.unreadCount).toBeGreaterThan(0);

    const seen = await server.authRequest('/api/notifications/seen', { cookie, method: 'POST' });
    expect(seen.status).toBe(200);
    expect(await seen.json()).toEqual({ ok: true });

    const after = (await (await server.authRequest('/api/notifications', { cookie })).json()) as {
      items: unknown[];
      unreadCount: number;
    };
    // Items still present, but none newer than the just-recorded "seen" time.
    expect(after.items.length).toBeGreaterThan(0);
    expect(after.unreadCount).toBe(0);
  });

  it('counts a freshly-added asset with an already-lapsed warranty as unread', async () => {
    // The user viewed the feed an hour ago...
    server.db
      .update(users)
      .set({ lastNotificationsSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
      .run();
    // ...then an asset is added now whose warranty lapsed two months ago. Its
    // due date is in the past, but it only appeared after the last "seen", so
    // it must still bump the unread badge.
    makeAsset(server, { warrantyUntil: new Date(Date.now() - 60 * DAY) });

    const body = (await (await server.authRequest('/api/notifications', { cookie })).json()) as {
      items: { type: string }[];
      unreadCount: number;
    };
    expect(body.items.some((i) => i.type === 'warranty')).toBe(true);
    expect(body.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it('includes open damage reports and scopes members to their own assets', async () => {
    const member = server.createUser({ role: 'member', email: 'member@example.com' });
    const memberCookie = server.loginAs(member);

    // Damage on an asset assigned to the member — should be visible to them.
    const mine = makeAsset(server, { assignedToUserId: member.id });
    server.db
      .insert(damageReports)
      .values({
        id: crypto.randomUUID(),
        assetId: mine.id,
        occurredAt: new Date(),
        reportedByUserId: member.id,
        description: 'Cracked screen',
        severity: 'major',
      })
      .run();

    // Damage on someone else's asset — hidden from the member, shown to admin.
    const other = makeAsset(server);
    server.db
      .insert(damageReports)
      .values({
        id: crypto.randomUUID(),
        assetId: other.id,
        occurredAt: new Date(),
        reportedByUserId: server.createUser({ email: 'rep@example.com' }).id,
        description: 'Dented',
        severity: 'minor',
      })
      .run();

    const memberBody = (await (
      await server.authRequest('/api/notifications', { cookie: memberCookie })
    ).json()) as { items: { type: string; link: string }[] };
    const memberDamages = memberBody.items.filter((i) => i.type === 'damage');
    expect(memberDamages).toHaveLength(1);
    expect(memberDamages[0]?.link).toBe(`/a/${mine.code}`);

    const adminBody = (await (
      await server.authRequest('/api/notifications', { cookie })
    ).json()) as { items: { type: string }[] };
    expect(adminBody.items.filter((i) => i.type === 'damage')).toHaveLength(2);
  });
});
