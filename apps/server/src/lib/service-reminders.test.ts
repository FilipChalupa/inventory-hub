import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { runServiceReminders } from './service-reminders.js';
import type { Email, EmailSender } from './email.js';
import { setupTestServer, type TestServer } from './test-server.js';

async function jsonPost(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const emailSenderFor = (server: TestServer): EmailSender => ({
  send: async (e: Email) => {
    server.sentEmails.push(e);
  },
});

async function createAsset(
  server: TestServer,
  cookie: string,
  name: string,
  serviceIntervalDays: number | null,
) {
  const res = await jsonPost(server, cookie, '/api/assets', {
    name,
    typeId: server.laptopTypeId,
    serviceIntervalDays,
  });
  return ((await res.json()) as { code: string }).code;
}

describe('runServiceReminders', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin', email: 'admin@example.com' }));
  });

  afterEach(() => {
    server.close();
  });

  it('emails admins about assets due for service, once, and re-arms after servicing', async () => {
    // Serviced 70 days ago on a 90-day interval → next service in ~20 days,
    // inside the 30-day window. After a fresh service it's 90 days out.
    const res = await jsonPost(server, cookie, '/api/assets', {
      name: 'Due',
      typeId: server.laptopTypeId,
      serviceIntervalDays: 90,
      lastServicedAt: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const { code } = (await res.json()) as { code: string };

    const first = await runServiceReminders(server.db, emailSenderFor(server), {
      publicAppUrl: 'http://localhost',
    });
    expect(first.found).toBe(1);
    expect(first.notifiedAdmins).toBe(1);
    expect(server.sentEmails.some((e) => /servis/i.test(e.subject))).toBe(true);

    const before = server.sentEmails.length;
    const second = await runServiceReminders(server.db, emailSenderFor(server), {
      publicAppUrl: '',
    });
    expect(second.found).toBe(0);
    expect(server.sentEmails.length).toBe(before);

    // Marking it serviced pushes the next-service date out AND re-arms the
    // reminder; with the clock unchanged it's now beyond the window.
    const serviced = await jsonPost(server, cookie, `/api/assets/${code}/service`, {});
    expect(serviced.status).toBe(200);
    const third = await runServiceReminders(server.db, emailSenderFor(server), {
      publicAppUrl: '',
    });
    expect(third.found).toBe(0);
  });

  it('ignores assets without a service schedule', async () => {
    await createAsset(server, cookie, 'No schedule', null);
    const result = await runServiceReminders(server.db, emailSenderFor(server), {
      publicAppUrl: '',
    });
    expect(result.found).toBe(0);
  });
});
