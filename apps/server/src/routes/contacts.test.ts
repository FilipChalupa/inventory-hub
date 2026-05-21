import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { contacts, loans } from '../db/schema.js';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

async function jsonPost(server: TestServer, cookie: string, path: string, body: unknown) {
  return server.authRequest(path, {
    cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('contacts API', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  it('CRUD round-trip: create → list → get → patch → delete', async () => {
    const created = await jsonPost(server, cookie, '/api/contacts', {
      name: 'Jan Test',
      organization: 'ACME',
      email: 'jan@example.com',
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const list = await server.authRequest('/api/contacts', { cookie });
    const body = (await list.json()) as { items: { id: string; name: string }[] };
    expect(body.items.find((c) => c.id === id)?.name).toBe('Jan Test');

    const patch = await server.authRequest(`/api/contacts/${id}`, {
      cookie,
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+420 777' }),
    });
    expect(patch.status).toBe(200);
    expect(server.db.select().from(contacts).where(eq(contacts.id, id)).get()!.phone).toBe(
      '+420 777',
    );

    const del = await server.authRequest(`/api/contacts/${id}`, {
      cookie,
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    expect(server.db.select().from(contacts).all()).toHaveLength(0);
  });

  it('filter by name + organization via ?q=', async () => {
    await jsonPost(server, cookie, '/api/contacts', { name: 'Adam ACME', organization: 'ACME' });
    await jsonPost(server, cookie, '/api/contacts', { name: 'Beáta Beta', organization: 'Beta' });
    const res = await server.authRequest('/api/contacts?q=ACME', { cookie });
    const body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.map((c) => c.name)).toEqual(['Adam ACME']);
  });

  it('loan can reference a contact and survives contact deletion (SET NULL)', async () => {
    const created = await jsonPost(server, cookie, '/api/contacts', { name: 'External Hire' });
    const { id: contactId } = (await created.json()) as { id: string };

    // Make an asset to loan.
    const asset = await jsonPost(server, cookie, '/api/assets', {
      name: 'Tool',
      typeId: server.laptopTypeId,
    });
    const { code } = (await asset.json()) as { code: string };

    const loan = await jsonPost(server, cookie, '/api/loans', {
      borrowerName: 'External Hire',
      borrowerContactId: contactId,
      assetCodes: [code],
    });
    expect(loan.status).toBe(201);
    const { id: loanId } = (await loan.json()) as { id: string };

    // The contact's detail endpoint includes recent loans.
    const detail = await server.authRequest(`/api/contacts/${contactId}`, { cookie });
    const detailBody = (await detail.json()) as { loans: { id: string }[] };
    expect(detailBody.loans.map((l) => l.id)).toContain(loanId);

    // Delete contact → loan should remain, contactId nulled out.
    await server.authRequest(`/api/contacts/${contactId}`, {
      cookie,
      method: 'DELETE',
    });
    const loanRow = server.db.select().from(loans).where(eq(loans.id, loanId)).get();
    expect(loanRow).toBeDefined();
    expect(loanRow!.borrowerContactId).toBeNull();
    expect(loanRow!.borrowerName).toBe('External Hire'); // historic name preserved
  });
});
