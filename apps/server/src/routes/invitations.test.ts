import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

async function jsonPost(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('invitations API', () => {
  let server: TestServer;
  let adminCookie: string;

  beforeEach(() => {
    server = setupTestServer();
    adminCookie = server.loginAs(server.createUser({ role: 'admin', email: 'admin@example.com' }));
  });

  afterEach(() => {
    server.close();
  });

  it('admin creates an invitation and the sender receives one email with the accept URL', async () => {
    const res = await jsonPost(server, adminCookie, '/api/invitations', {
      email: 'new@example.com',
      role: 'member',
    });
    expect(res.status).toBe(201);
    expect(server.sentEmails).toHaveLength(1);
    const mail = server.sentEmails[0]!;
    expect(mail.to).toBe('new@example.com');
    expect(mail.subject).toMatch(/Pozv/);
    expect(mail.text).toMatch(/accept-invite\?token=/);
  });

  it('non-admin cannot create invitations', async () => {
    const memberCookie = server.loginAs(
      server.createUser({ role: 'member', email: 'm@example.com' }),
    );
    const res = await jsonPost(server, memberCookie, '/api/invitations', {
      email: 'who@example.com',
      role: 'member',
    });
    expect(res.status).toBe(403);
    expect(server.sentEmails).toHaveLength(0);
  });

  it('rejects a duplicate pending invitation', async () => {
    const first = await jsonPost(server, adminCookie, '/api/invitations', {
      email: 'dup@example.com',
      role: 'operator',
    });
    expect(first.status).toBe(201);
    const second = await jsonPost(server, adminCookie, '/api/invitations', {
      email: 'dup@example.com',
      role: 'operator',
    });
    expect(second.status).toBe(409);
  });

  it('rejects invitation for an existing user', async () => {
    server.createUser({ email: 'taken@example.com', role: 'member' });
    const res = await jsonPost(server, adminCookie, '/api/invitations', {
      email: 'taken@example.com',
      role: 'member',
    });
    expect(res.status).toBe(409);
  });

  it('accept-invite creates the user and a session cookie', async () => {
    const created = await jsonPost(server, adminCookie, '/api/invitations', {
      email: 'accept@example.com',
      role: 'operator',
    });
    const created2 = (await created.json()) as { acceptUrl: string };
    const token = new URL(created2.acceptUrl).searchParams.get('token')!;

    const res = await server.app.request('/auth/accept-invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name: 'Nový Uživatel' }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/inv_session=/);
  });
});
