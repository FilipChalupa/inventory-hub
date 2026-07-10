import { lookup } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve, sep } from 'node:path';
import type { Env } from '../env.js';

/** Supported upload MIME types → file extension. */
export const ALLOWED_MIME = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['application/pdf', 'pdf'],
]);

/**
 * Detects a file's MIME type from its leading "magic" bytes, independent of
 * any client- or server-supplied Content-Type. Returns one of our supported
 * MIME strings, or null when the signature isn't recognised.
 */
export function sniffMime(buffer: Buffer): string | null {
  const b = buffer;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50 // "WEBP"
  ) {
    return 'image/webp';
  }
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return 'application/pdf'; // "%PDF"
  }
  return null;
}

/** True for an IPv4 literal that must never be fetched (private/reserved). */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 (incl. 0.0.0.0)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

/**
 * Extracts the embedded IPv4 from an IPv4-mapped IPv6 address, or null.
 * Handles both the dotted form (`::ffff:127.0.0.1`) and the hex form that
 * Node's URL parser normalises to (`::ffff:7f00:1`) — otherwise a mapped
 * loopback/private address slips past the guard.
 */
function mappedIpv4(addr: string): string | null {
  const dotted = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted && addr.includes('::')) return dotted[1]!;
  const hex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return null;
}

/** True for an IPv6 literal that must never be fetched (private/reserved). */
function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  // IPv4-mapped / -compatible — judge the embedded v4 so a mapped loopback or
  // private address (e.g. ::ffff:127.0.0.1) can't bypass the v4 rules.
  const embedded = mappedIpv4(addr);
  if (embedded) return isBlockedIpv4(embedded);
  const head = parseInt(addr.split(':')[0] || '0', 16);
  if (Number.isNaN(head)) return true;
  const byte0 = head >> 8;
  const byte1 = head & 0xff;
  if ((byte0 & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (byte0 === 0xfe && (byte1 & 0xc0) === 0x80) return true; // fe80::/10 link-local
  return false;
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true; // not a parseable IP literal → treat as unsafe
}

/**
 * SSRF guard for remote fetches: allows only http(s) URLs whose host resolves
 * exclusively to public IP addresses. A hostname is resolved to ALL of its
 * addresses and every one must be public, so a DNS record that points at a
 * private/loopback/link-local/reserved range (e.g. cloud metadata at
 * 169.254.169.254) is rejected. Never throws — returns false on any error.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, ''); // strip IPv6 brackets
  if (!hostname) return false;
  try {
    if (isIP(hostname)) return !isBlockedAddress(hostname);
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((entry) => !isBlockedAddress(entry.address));
  } catch {
    return false;
  }
}

/**
 * Returns a path like `2026/05/<uuid>.jpg` rooted inside UPLOAD_DIR.
 * The returned path is what we persist in DB; we resolve it against
 * UPLOAD_DIR at serve time and validate it stays under the upload root.
 */
export function generateRelativePath(extension: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${crypto.randomUUID()}.${extension}`;
}

export function isInside(parent: string, child: string): boolean {
  const p = resolve(parent) + sep;
  const c = resolve(child);
  return c.startsWith(p);
}

/**
 * Persists a buffer of a known MIME type into UPLOAD_DIR and returns the
 * stored relative path, or null when the MIME is unsupported or the resolved
 * path would escape the upload root.
 */
export async function saveUploadBuffer(
  env: Env,
  buffer: Buffer,
  mime: string,
): Promise<string | null> {
  const ext = ALLOWED_MIME.get(mime);
  if (!ext) return null;
  // Defense in depth: the declared MIME must match the file's real magic
  // bytes, so a caller can't smuggle another payload in under an allowed type.
  if (sniffMime(buffer) !== mime) return null;
  const relative = generateRelativePath(ext);
  const absolute = resolve(env.UPLOAD_DIR, relative);
  if (!isInside(env.UPLOAD_DIR, absolute)) return null;
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, buffer);
  return relative;
}

/**
 * Downloads a remote image/document URL into UPLOAD_DIR and returns the stored
 * relative path, or null on any failure (never throws). Size-capped by
 * UPLOAD_MAX_BYTES. Used by the bulk import to pull source-system media.
 *
 * Transient failures (network error, non-2xx) are retried up to `retries`
 * times; a deterministic failure (unsupported type, too large) returns null
 * immediately without burning retries.
 */
export async function storeRemoteFile(env: Env, url: string, retries = 1): Promise<string | null> {
  // SSRF guard: only public http(s) targets are fetched at all.
  if (!(await assertPublicHttpUrl(url))) return null;
  for (let attempt = 0; ; attempt++) {
    try {
      // - redirect: 'error' stops a vetted public URL from bouncing (3xx) to a
      //   private one *after* the pre-flight check (redirect/TOCTOU bypass);
      //   a rejected redirect throws and is treated as a failure below.
      // - AbortSignal.timeout caps a slow/hanging origin at 10s.
      const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        if (attempt < retries) continue;
        return null;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      // Deterministic outcomes — don't retry.
      if (buffer.byteLength > env.UPLOAD_MAX_BYTES) return null;
      // Trust the file's magic bytes, not the origin's Content-Type header.
      const mime = sniffMime(buffer);
      if (!mime) return null;
      return await saveUploadBuffer(env, buffer, mime);
    } catch {
      if (attempt < retries) continue;
      return null;
    }
  }
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once, preserving
 * input order in the result. Never rejects on a single failure — `fn` is
 * expected to resolve (e.g. to null) rather than throw.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
