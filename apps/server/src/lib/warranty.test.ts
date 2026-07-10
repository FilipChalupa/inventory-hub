import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { runWarrantyReminders } from './warranty.js';
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
  warrantyUntil: Date | null,
) {
  const res = await jsonPost(server, cookie, '/api/assets', {
    name,
    typeId: server.laptopTypeId,
    warrantyUntil: warrantyUntil ? warrantyUntil.toISOString() : null,
  });
  return ((await res.json()) as { code: string }).code;
}

const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

describe('runWarrantyReminders', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin', email: 'admin@example.com' }));
  });

  afterEach(() => {
    server.close();
  });

  it('emails admins about assets expiring within the window, once', async () => {
    await createAsset(server, cookie, 'Expiring soon', inDays(10));

    const first = await runWarrantyReminders(server.db, emailSenderFor(server), {
      publicAppUrl: 'http://localhost',
    });
    expect(first.found).toBe(1);
    expect(first.notifiedAdmins).toBe(1);
    expect(server.sentEmails.some((e) => /záruk/i.test(e.subject))).toBe(true);

    // Idempotent: a rerun finds nothing new and sends no more mail.
    const before = server.sentEmails.length;
    const second = await runWarrantyReminders(server.db, emailSenderFor(server), {
      publicAppUrl: 'http://localhost',
    });
    expect(second.found).toBe(0);
    expect(server.sentEmails.length).toBe(before);
  });

  it('ignores assets whose warranty is beyond the window or unset', async () => {
    await createAsset(server, cookie, 'Far future', inDays(365));
    await createAsset(server, cookie, 'No warranty', null);

    const result = await runWarrantyReminders(server.db, emailSenderFor(server), {
      publicAppUrl: 'http://localhost',
    });
    expect(result.found).toBe(0);
  });

  it('re-arms the reminder when the warranty date changes', async () => {
    const code = await createAsset(server, cookie, 'Renewed', inDays(5));
    await runWarrantyReminders(server.db, emailSenderFor(server), { publicAppUrl: '' });

    // Push the warranty out and back into the window — should notify again.
    await server.authRequest(`/api/assets/${code}`, {
      cookie,
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ warrantyUntil: inDays(20).toISOString() }),
    });
    const again = await runWarrantyReminders(server.db, emailSenderFor(server), {
      publicAppUrl: '',
    });
    expect(again.found).toBe(1);
  });
});
