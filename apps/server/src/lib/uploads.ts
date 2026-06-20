import { mkdir, writeFile } from 'node:fs/promises';
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
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (attempt < retries) continue;
        return null;
      }
      const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      const buffer = Buffer.from(await res.arrayBuffer());
      // Deterministic outcomes — don't retry.
      if (buffer.byteLength > env.UPLOAD_MAX_BYTES) return null;
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
