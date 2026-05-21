import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { assetTypes } from '../db/schema.js';
import { setupTestServer, type TestServer } from '../lib/test-server.js';

async function importCsv(server: TestServer, cookie: string, text: string, dryRun: boolean) {
  const form = new FormData();
  form.append('file', new File([text], 'types.csv', { type: 'text/csv' }));
  form.append('dryRun', dryRun ? 'true' : 'false');
  return server.authRequest('/api/asset-types/import', {
    cookie,
    method: 'POST',
    body: form,
  });
}

describe('asset-types import', () => {
  let server: TestServer;
  let adminCookie: string;

  beforeEach(() => {
    server = setupTestServer();
    adminCookie = server.loginAs(server.createUser({ role: 'admin', email: 'a@e.cz' }));
  });

  afterEach(() => {
    server.close();
  });

  it('commits new types from CSV', async () => {
    const res = await importCsv(
      server,
      adminCookie,
      'name,code_prefix\r\nMonitor,MON\r\nKabel,CBL\r\n',
      false,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number };
    expect(body.created).toBe(2);
    const all = server.db.select().from(assetTypes).all();
    expect(all.map((t) => t.codePrefix).sort()).toEqual(['CBL', 'LAP', 'MON']); // LAP from seed
  });

  it('rejects duplicate prefix (already in DB)', async () => {
    const res = await importCsv(
      server,
      adminCookie,
      'name,code_prefix\r\nLaptopX,LAP\r\n',
      false,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { preview: { issues: string[] }[] };
    expect(body.preview[0]!.issues.some((s) => /existuje/.test(s))).toBe(true);
  });

  it('rejects duplicate prefix within the CSV itself', async () => {
    const res = await importCsv(
      server,
      adminCookie,
      'name,code_prefix\r\nA,XX\r\nB,XX\r\n',
      true,
    );
    const body = (await res.json()) as { preview: { issues: string[] }[]; hasErrors: boolean };
    expect(body.hasErrors).toBe(true);
    expect(body.preview[1]!.issues.some((s) => /Duplicitn/.test(s))).toBe(true);
  });

  it('rejects non-admin', async () => {
    const operator = server.loginAs(server.createUser({ role: 'operator', email: 'o@e.cz' }));
    const res = await importCsv(server, operator, 'name,code_prefix\r\nA,YY\r\n', false);
    expect(res.status).toBe(403);
  });
});
