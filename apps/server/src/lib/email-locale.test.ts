import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestServer, type TestServer } from './test-server.js';
import { loans, users } from '../db/schema.js';
import { runOverdueCheck } from './overdue.js';

let server: TestServer;
beforeEach(() => {
  server = setupTestServer({ EMAIL_LOCALE: 'cs' });
});
afterEach(() => server.close());

const json = (cookie: string, method: string, path: string, body: unknown) =>
  server.authRequest(path, {
    cookie,
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('per-user email language', () => {
  it('a user can set their language; /auth/me reports it', async () => {
    const user = server.createUser({ role: 'member' });
    const cookie = server.loginAs(user);
    expect((await json(cookie, 'PUT', '/auth/me/locale', { locale: 'en' })).status).toBe(200);
    const me = (await (await server.authRequest('/auth/me', { cookie })).json()) as {
      user: { locale: string };
    };
    expect(me.user.locale).toBe('en');
    expect((await json(cookie, 'PUT', '/auth/me/locale', { locale: 'de' })).status).toBe(400);
  });

  it('emails to a user follow their language, others keep the org default', async () => {
    const admin = server.createUser({ role: 'admin' });
    const cookie = server.loginAs(admin);
    const english = server.createUser({ role: 'member', email: 'en@x.cz' });
    const czech = server.createUser({ role: 'member', email: 'cs@x.cz' });
    server.db.update(users).set({ locale: 'en' }).where(eq(users.id, english.id)).run();

    for (const u of [english, czech]) {
      const asset = (await (
        await json(cookie, 'POST', '/api/assets', { name: 'Kit', typeId: server.laptopTypeId })
      ).json()) as { code: string };
      await json(cookie, 'POST', `/api/assets/${asset.code}/assign`, { userId: u.id });
    }
    const toEn = server.sentEmails.find((e) => e.to === 'en@x.cz')!;
    const toCs = server.sentEmails.find((e) => e.to === 'cs@x.cz')!;
    expect(toEn.subject).toContain('assigned to you');
    expect(toCs.subject).toContain('přiřazen');
  });

  it('an overdue borrower with an account gets their language', async () => {
    const admin = server.createUser({ role: 'admin', email: 'boss@x.cz' });
    const cookie = server.loginAs(admin);
    const borrower = server.createUser({ role: 'member', email: 'b@x.cz' });
    server.db.update(users).set({ locale: 'en' }).where(eq(users.id, borrower.id)).run();
    const asset = (await (
      await json(cookie, 'POST', '/api/assets', { name: 'Kit', typeId: server.laptopTypeId })
    ).json()) as { code: string };
    const loan = (await (
      await json(cookie, 'POST', '/api/loans', {
        borrowerName: 'B',
        borrowerUserId: borrower.id,
        borrowerContact: 'b@x.cz',
        assetCodes: [asset.code],
      })
    ).json()) as { id?: string; loan?: { id: string } };
    const loanId = loan.loan?.id ?? loan.id!;
    server.db
      .update(loans)
      .set({ expectedReturnAt: new Date(Date.now() - 86_400_000) })
      .where(eq(loans.id, loanId))
      .run();
    await runOverdueCheck(
      server.db,
      { send: async (e) => void server.sentEmails.push(e) },
      {
        publicAppUrl: 'https://inv.example',
        locale: 'cs',
      },
    );
    const toBorrower = server.sentEmails.find((e) => e.to === 'b@x.cz');
    expect(toBorrower?.subject).toBe('Reminder: please return borrowed items');
    // The admin never picked a language → org default (Czech).
    const toAdmin = server.sentEmails.find((e) => e.to === 'boss@x.cz');
    expect(toAdmin?.subject).toMatch(/[ěščřžýáíéůú]/);
  });
});
