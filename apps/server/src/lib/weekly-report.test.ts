import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { runWeeklyReport } from './weekly-report.js';
import type { Email, EmailSender } from './email.js';
import { setupTestServer, type TestServer } from './test-server.js';

const emailSenderFor = (server: TestServer): EmailSender => ({
  send: async (e: Email) => {
    server.sentEmails.push(e);
  },
});

describe('runWeeklyReport', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin', email: 'admin@example.com' }));
  });

  afterEach(() => {
    server.close();
  });

  it('emails admins a digest with an asset count', async () => {
    await server.authRequest('/api/assets', {
      cookie,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Counted', code: 'LAP-71001' }),
    });

    const result = await runWeeklyReport(server.db, emailSenderFor(server), {
      publicAppUrl: 'http://localhost',
    });

    expect(result.notifiedAdmins).toBe(1);
    const mail = server.sentEmails.find((e) => /přehled/i.test(e.subject));
    expect(mail).toBeTruthy();
    expect(mail!.text).toMatch(/Aktivních assetů: 1/);
  });
});
