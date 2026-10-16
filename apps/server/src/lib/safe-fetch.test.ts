import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupFunction } from 'node:net';
import { fetchPublicBuffer, publicOnlyLookup } from './safe-fetch.js';

let server: Server;
let port = 0;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/small') return res.end('hello');
    if (req.url === '/big') return res.end(Buffer.alloc(50_000));
    if (req.url === '/endless') {
      res.writeHead(200); // no content-length
      const timer = setInterval(() => res.write(Buffer.alloc(8_192)), 1);
      res.on('close', () => clearInterval(timer));
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/small' });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

// Lets tests reach the local server under a "public" name, standing in for a
// real public host; production always uses publicOnlyLookup.
const toLocal: LookupFunction = (_host, options, cb) => {
  if ((options as { all?: boolean }).all) {
    (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
      { address: '127.0.0.1', family: 4 },
    ]);
  } else cb(null, '127.0.0.1', 4);
};

describe('fetchPublicBuffer', () => {
  it('refuses hosts that resolve to private addresses at connect time', async () => {
    // "localhost" passes as a hostname but resolves to 127.0.0.1 — exactly
    // what a rebinding DNS answer would do after a pre-check.
    expect(await fetchPublicBuffer(`http://localhost:${port}/small`, { maxBytes: 100 })).toBeNull();
    expect(await fetchPublicBuffer(`http://127.0.0.1:${port}/small`, { maxBytes: 100 })).toBeNull();
    expect(await fetchPublicBuffer(`http://[::1]:${port}/small`, { maxBytes: 100 })).toBeNull();
  });

  it('publicOnlyLookup rejects loopback answers', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((r) =>
      publicOnlyLookup('localhost', {}, (e) => r(e)),
    );
    expect(err?.code).toBe('EBLOCKED');
  });

  it('downloads a small body, caps big and endless ones, never follows redirects', async () => {
    const get = (path: string, maxBytes = 1_000) =>
      fetchPublicBuffer(`http://files.test:${port}${path}`, { maxBytes, lookup: toLocal });
    expect((await get('/small'))?.toString()).toBe('hello');
    expect(await get('/big')).toBeNull();
    expect(await get('/endless', 100_000)).toBeNull();
    expect(await get('/redirect')).toBeNull();
    expect(await get('/missing')).toBeNull();
    expect(await fetchPublicBuffer('ftp://x.test/a', { maxBytes: 10 })).toBeNull();
  });
});
