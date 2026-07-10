import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { loans } from '../db/schema.js';
import { runOverdueCheck, runStartReminders } from './overdue.js';
import { setupTestServer, type TestServer } from './test-server.js';

async function jsonPost(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function setupOverdueLoan(server: TestServer, cookie: string, daysOverdue: number) {
  const created = await jsonPost(server, cookie, '/api/assets', {
    name: 'Loaned',
    typeId: server.laptopTypeId,
  });
  const { code } = (await created.json()) as { code: string };
  const past = new Date(Date.now() - daysOverdue * 24 * 60 * 60 * 1000);
  const loan = await jsonPost(server, cookie, '/api/loans', {
    borrowerName: 'Jan Po-termínu',
    borrowerContact: 'jan@example.com',
    expectedReturnAt: past.toISOString(),
    assetCodes: [code],
  });
  return ((await loan.json()) as { id: string }).id;
}

describe('runOverdueCheck', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin', email: 'admin@example.com' }));
  });

  afterEach(() => {
    server.close();
  });

  it('notifies borrower and admin once for each overdue loan', async () => {
    const loanId = await setupOverdueLoan(server, cookie, 3);
    const result = await runOverdueCheck(
      server.db,
      {
        send: async (e) => {
          server.sentEmails.push(e);
        },
      },
      { publicAppUrl: 'http://localhost' },
    );

    expect(result.found).toBe(1);
    expect(result.notifiedBorrowers).toBe(1);
    expect(result.notifiedAdmins).toBe(1);

    const borrowerMail = server.sentEmails.find((m) => m.to === 'jan@example.com');
    const adminMail = server.sentEmails.find((m) => m.to === 'admin@example.com');
    expect(borrowerMail).toBeDefined();
    expect(adminMail).toBeDefined();
    expect(adminMail!.text).toMatch(/1 výpůjček po termínu/);

    const row = server.db.select().from(loans).where(eq(loans.id, loanId)).get()!;
    expect(row.overdueNotifiedAt).not.toBeNull();
  });

  it('is idempotent — running twice does not re-notify', async () => {
    await setupOverdueLoan(server, cookie, 5);
    await runOverdueCheck(
      server.db,
      {
        send: async (e) => {
          server.sentEmails.push(e);
        },
      },
      { publicAppUrl: 'http://localhost' },
    );
    const countAfterFirst = server.sentEmails.length;

    const second = await runOverdueCheck(
      server.db,
      {
        send: async (e) => {
          server.sentEmails.push(e);
        },
      },
      { publicAppUrl: 'http://localhost' },
    );
    expect(second.found).toBe(0);
    expect(server.sentEmails.length).toBe(countAfterFirst);
  });

  it('skips loans that have all items returned', async () => {
    const code = (await jsonPost(server, cookie, '/api/assets', {
      name: 'Done',
      typeId: server.laptopTypeId,
    }).then((r) => r.json())) as { code: string };
    const past = new Date(Date.now() - 86_400_000);
    const created = await jsonPost(server, cookie, '/api/loans', {
      borrowerName: 'Vrácený',
      borrowerContact: 'a@b.cz',
      expectedReturnAt: past.toISOString(),
      assetCodes: [code.code],
    });
    const { id: loanId } = (await created.json()) as { id: string };
    const detail = await server.authRequest(`/api/loans/${loanId}`, { cookie });
    const itemId = ((await detail.json()) as { loan: { items: { id: string }[] } }).loan.items[0]!
      .id;
    await jsonPost(server, cookie, `/api/loans/${loanId}/items/${itemId}/return`, {
      returnCondition: 'ok',
    });

    const result = await runOverdueCheck(
      server.db,
      {
        send: async (e) => {
          server.sentEmails.push(e);
        },
      },
      { publicAppUrl: '' },
    );
    expect(result.found).toBe(0);
  });

  it('admin endpoint /api/loans/notify-overdue returns the run result', async () => {
    await setupOverdueLoan(server, cookie, 2);
    const res = await server.authRequest('/api/loans/notify-overdue', {
      cookie,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { found: number };
    expect(body.found).toBe(1);
  });

  it('non-admin cannot trigger the overdue notifier', async () => {
    const memberCookie = server.loginAs(server.createUser({ role: 'member', email: 'm@e.cz' }));
    const res = await server.authRequest('/api/loans/notify-overdue', {
      cookie: memberCookie,
      method: 'POST',
    });
    expect(res.status).toBe(403);
  });
});

describe('runStartReminders', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin', email: 'admin@example.com' }));
  });

  afterEach(() => {
    server.close();
  });

  async function setupPlannedLoan(startsInHours: number) {
    const created = await jsonPost(server, cookie, '/api/assets', {
      name: 'Planned',
      typeId: server.laptopTypeId,
    });
    const { code } = (await created.json()) as { code: string };
    const start = new Date(Date.now() + startsInHours * 60 * 60 * 1000);
    const loan = await jsonPost(server, cookie, '/api/loans', {
      borrowerName: 'Eva Plánovaná',
      borrowerContact: 'eva@example.com',
      loanedAt: start.toISOString(),
      assetCodes: [code],
    });
    return ((await loan.json()) as { id: string }).id;
  }

  it('reminds borrower and admin for loans starting within 24h, once', async () => {
    const loanId = await setupPlannedLoan(12);
    const send = async (e: { to: string; subject: string; text: string }) => {
      server.sentEmails.push(e);
    };

    const result = await runStartReminders(
      server.db,
      { send },
      { publicAppUrl: 'http://localhost' },
    );
    expect(result.found).toBe(1);
    expect(result.notifiedBorrowers).toBe(1);
    expect(result.notifiedAdmins).toBe(1);
    expect(server.sentEmails.find((m) => m.to === 'eva@example.com')).toBeDefined();

    const row = server.db.select().from(loans).where(eq(loans.id, loanId)).get()!;
    expect(row.startReminderSentAt).not.toBeNull();

    // Idempotent — a second run sends nothing.
    const second = await runStartReminders(
      server.db,
      { send },
      { publicAppUrl: 'http://localhost' },
    );
    expect(second.found).toBe(0);
  });

  it('does not remind loans starting more than 24h away', async () => {
    await setupPlannedLoan(48);
    const result = await runStartReminders(
      server.db,
      {
        send: async (e) => {
          server.sentEmails.push(e);
        },
      },
      { publicAppUrl: 'http://localhost' },
    );
    expect(result.found).toBe(0);
  });
});
