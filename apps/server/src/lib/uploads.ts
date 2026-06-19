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
 */
export async function storeRemoteFile(env: Env, url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > env.UPLOAD_MAX_BYTES) return null;
    return await saveUploadBuffer(env, buffer, mime);
  } catch {
    return null;
  }
}
