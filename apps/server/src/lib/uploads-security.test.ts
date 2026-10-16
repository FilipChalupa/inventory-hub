import { describe, it, expect } from 'vitest';
import { assertPublicHttpUrl, readCapped, sniffMime } from './uploads.js';

describe('sniffMime', () => {
  it('detects real image/pdf signatures', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(sniffMime(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(sniffMime(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP'),
    ]);
    expect(sniffMime(webp)).toBe('image/webp');
  });

  it('rejects content whose bytes do not match a supported type', () => {
    // e.g. an HTML/script payload uploaded with a spoofed image/png Content-Type.
    expect(sniffMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffMime(Buffer.from([]))).toBeNull();
  });
});

describe('assertPublicHttpUrl (SSRF guard)', () => {
  it('rejects non-http(s) schemes and malformed URLs', async () => {
    expect(await assertPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(await assertPublicHttpUrl('ftp://example.com/x')).toBe(false);
    expect(await assertPublicHttpUrl('not a url')).toBe(false);
  });

  it('rejects private, loopback and link-local IP literals', async () => {
    expect(await assertPublicHttpUrl('http://127.0.0.1/')).toBe(false);
    expect(await assertPublicHttpUrl('http://10.0.0.5/')).toBe(false);
    expect(await assertPublicHttpUrl('http://192.168.1.1/')).toBe(false);
    expect(await assertPublicHttpUrl('http://172.16.0.1/')).toBe(false);
    // Cloud metadata endpoint — the classic SSRF target.
    expect(await assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(await assertPublicHttpUrl('http://[::1]/')).toBe(false);
    // IPv4-mapped IPv6 must not smuggle a loopback address past the guard.
    expect(await assertPublicHttpUrl('http://[::ffff:127.0.0.1]/')).toBe(false);
  });

  it('allows a public IP literal', async () => {
    expect(await assertPublicHttpUrl('https://93.184.216.34/')).toBe(true);
  });
});

describe('readCapped', () => {
  const streamOf = (chunks: number[]) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const n of chunks) controller.enqueue(new Uint8Array(n));
          controller.close();
        },
      }),
    );

  it('returns the body when under the cap', async () => {
    const buf = await readCapped(streamOf([3, 4]), 10);
    expect(buf?.byteLength).toBe(7);
  });

  it('gives up as soon as the stream passes the cap', async () => {
    expect(await readCapped(streamOf([6, 6, 6]), 10)).toBeNull();
  });

  it('rejects up front on an oversized Content-Length', async () => {
    const res = new Response('x', { headers: { 'content-length': '999999' } });
    expect(await readCapped(res, 10)).toBeNull();
  });

  it('stops an endless body at the cap', async () => {
    let pulls = 0;
    const endless = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(1024));
        },
      }),
    );
    expect(await readCapped(endless, 10_000)).toBeNull();
    expect(pulls).toBeLessThan(20);
  });
});
