import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { isBlockedAddress } from './uploads.js';

/**
 * DNS resolver for outbound connections that refuses private/reserved
 * addresses *at connect time*. Validating a URL with one DNS query and then
 * letting the HTTP client resolve it again leaves a window for DNS rebinding
 * (the second answer points at 127.0.0.1 or cloud metadata); doing the check
 * inside the socket's own lookup closes it — the address checked is the
 * address connected to.
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as { address: string; family: number }[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      const blocked = Object.assign(new Error(`Refusing non-public address for ${hostname}`), {
        code: 'EBLOCKED',
      });
      return callback(blocked, '', 0);
    }
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    } else {
      callback(null, list[0]!.address, list[0]!.family);
    }
  });
};

/**
 * GETs a public http(s) URL into memory with SSRF protection and a hard size
 * cap. Returns null on any failure — non-2xx, redirects (never followed, so a
 * vetted host can't bounce us inward), private targets, timeout, or a body
 * over `maxBytes` (the download is aborted as soon as it passes the cap).
 */
export function fetchPublicBuffer(
  rawUrl: string,
  opts: { maxBytes: number; timeoutMs?: number; lookup?: LookupFunction },
): Promise<Buffer | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return Promise.resolve(null);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.resolve(null);
  // IP literals never go through lookup, so judge them here.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedAddress(host)) return Promise.resolve(null);

  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = client.get(
      url,
      { lookup: opts.lookup ?? publicOnlyLookup, timeout: opts.timeoutMs ?? 10_000 },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          return resolve(null);
        }
        const declared = Number(res.headers['content-length'] ?? NaN);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          req.destroy();
          return resolve(null);
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > opts.maxBytes) {
            req.destroy();
            resolve(null);
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks, total)));
        res.on('error', () => resolve(null));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}
