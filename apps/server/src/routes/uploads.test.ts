import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { setupTestServer, type TestServer } from '../lib/test-server.js';
import { _resetRateLimits } from '../lib/rate-limit.js';

// 2x2 transparent PNG.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000020000000208060000007266b8de0000001249444154789c63600060006000000000060003a3a1f5a40000000049454e44ae426082',
  'hex',
);

async function postFile(server: TestServer, cookie: string, file: File, fieldName = 'file') {
  const form = new FormData();
  form.append(fieldName, file);
  return server.authRequest('/api/uploads', {
    cookie,
    method: 'POST',
    body: form,
  });
}

describe('uploads', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    _resetRateLimits();
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  it('accepts a PNG and returns a path that can be fetched back', async () => {
    const file = new File([TINY_PNG], 'a.png', { type: 'image/png' });
    const res = await postFile(server, cookie, file);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; url: string };
    expect(body.path).toMatch(/^\d{4}\/\d{2}\/[a-f0-9-]+\.png$/);

    const get = await server.authRequest(`/api/uploads/${body.path}`, { cookie });
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
  });

  it('rejects an unsupported MIME (415)', async () => {
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const res = await postFile(server, cookie, file);
    expect(res.status).toBe(415);
  });

  it('rejects a too-large file (413)', async () => {
    // 6 MB > default 5 MB limit
    const big = Buffer.alloc(6 * 1024 * 1024, 0);
    const file = new File([big], 'big.png', { type: 'image/png' });
    const res = await postFile(server, cookie, file);
    expect(res.status).toBe(413);
  });

  it('returns 400 when the file field is missing', async () => {
    const form = new FormData();
    form.append('not-a-file', 'oops');
    const res = await server.authRequest('/api/uploads', {
      cookie,
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated uploads with 401', async () => {
    const file = new File([TINY_PNG], 'a.png', { type: 'image/png' });
    const form = new FormData();
    form.append('file', file);
    const res = await server.app.request('/api/uploads', {
      method: 'POST',
      body: form,
      headers: { Origin: server.env.PUBLIC_APP_URL },
    });
    expect(res.status).toBe(401);
  });

  it('rate-limits after exceeding the per-IP threshold (429)', async () => {
    // The upload limiter is 60/min; hammering with same IP should eventually 429.
    // Use a deliberately tight bucket by faking the IP and exhausting it.
    const file = () => new File([TINY_PNG], 'a.png', { type: 'image/png' });
    const headersWithIp = { 'x-forwarded-for': '9.9.9.9' };
    let blocked = false;
    for (let i = 0; i < 65; i++) {
      const form = new FormData();
      form.append('file', file());
      const res = await server.authRequest('/api/uploads', {
        cookie,
        method: 'POST',
        body: form,
        headers: headersWithIp,
      });
      if (res.status === 429) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });
});

describe('asset photos', () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(() => {
    _resetRateLimits();
    server = setupTestServer();
    cookie = server.loginAs(server.createUser({ role: 'admin' }));
  });

  afterEach(() => {
    server.close();
  });

  async function makeAsset(): Promise<string> {
    const res = await server.authRequest('/api/assets', {
      cookie,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', typeId: server.laptopTypeId }),
    });
    return ((await res.json()) as { code: string }).code;
  }

  it('adds, lists, and removes a photo path on an asset', async () => {
    const code = await makeAsset();
    const path = '2026/01/abc.png';

    const add = await server.authRequest(`/api/assets/${code}/photos`, {
      cookie,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    expect(add.status).toBe(200);
    const addBody = (await add.json()) as { photoPaths: string[] };
    expect(addBody.photoPaths).toEqual([path]);

    const remove = await server.authRequest(`/api/assets/${code}/photos`, {
      cookie,
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    expect(remove.status).toBe(200);
    const removeBody = (await remove.json()) as { photoPaths: string[] };
    expect(removeBody.photoPaths).toEqual([]);
  });

  it('is idempotent — adding the same path twice keeps a single entry', async () => {
    const code = await makeAsset();
    const path = '2026/01/dup.png';
    await server.authRequest(`/api/assets/${code}/photos`, {
      cookie,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const second = await server.authRequest(`/api/assets/${code}/photos`, {
      cookie,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { photoPaths: string[] };
    expect(body.photoPaths).toEqual([path]);
  });
});
