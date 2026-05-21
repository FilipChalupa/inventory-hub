import { Hono } from 'hono';
import { mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, normalize, sep } from 'node:path';
import type { AppContext } from '../app.js';
import { rateLimit } from '../lib/rate-limit.js';

const ALLOWED_MIME = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

/**
 * Returns a path like `2026/05/<uuid>.jpg` rooted inside UPLOAD_DIR.
 * The returned path is what we persist in DB; we resolve it against
 * UPLOAD_DIR at serve time and validate it stays under the upload root.
 */
function generateRelativePath(extension: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${crypto.randomUUID()}.${extension}`;
}

function isInside(parent: string, child: string): boolean {
  const p = resolve(parent) + sep;
  const c = resolve(child);
  return c.startsWith(p);
}

export const uploadRoutes = new Hono<AppContext>()
  .post('/', rateLimit({ bucket: 'uploads', windowMs: 60_000, max: 60 }), async (c) => {
    const env = c.get('env');
    const contentLength = Number(c.req.header('content-length') ?? '0');
    if (contentLength > env.UPLOAD_MAX_BYTES * 2) {
      // Cheap pre-check; multipart adds overhead so we allow 2x headroom
      return c.json(
        { error: { message: `Soubor je větší než limit ${env.UPLOAD_MAX_BYTES} B` } },
        413,
      );
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: { message: 'Neplatné multipart data' } }, 400);
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return c.json({ error: { message: 'Pole „file" je povinné' } }, 400);
    }

    if (file.size > env.UPLOAD_MAX_BYTES) {
      return c.json(
        { error: { message: `Soubor je větší než limit ${env.UPLOAD_MAX_BYTES} B` } },
        413,
      );
    }

    const ext = ALLOWED_MIME.get(file.type);
    if (!ext) {
      return c.json(
        {
          error: {
            message: `Nepodporovaný typ souboru (${file.type || 'neznámý'}). Povoleno: JPEG, PNG, WebP, GIF`,
          },
        },
        415,
      );
    }

    const relative = generateRelativePath(ext);
    const absolute = resolve(env.UPLOAD_DIR, relative);
    if (!isInside(env.UPLOAD_DIR, absolute)) {
      return c.json({ error: { message: 'Neplatná cesta' } }, 400);
    }

    await mkdir(resolve(absolute, '..'), { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(absolute, buf);

    return c.json({
      path: relative,
      url: `/api/uploads/${relative}`,
      size: file.size,
      contentType: file.type,
    });
  })
  .get('/:y/:m/:name', async (c) => {
    const env = c.get('env');
    const { y, m, name } = c.req.param();
    const requested = normalize(join(y, m, name));
    const absolute = resolve(env.UPLOAD_DIR, requested);
    if (!isInside(env.UPLOAD_DIR, absolute)) {
      return c.json({ error: { message: 'Neplatná cesta' } }, 400);
    }

    let info;
    try {
      info = await stat(absolute);
    } catch {
      return c.json({ error: { message: 'Soubor nenalezen' } }, 404);
    }
    if (!info.isFile()) {
      return c.json({ error: { message: 'Soubor nenalezen' } }, 404);
    }

    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const contentType =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : 'application/octet-stream';

    const data = await readFile(absolute);
    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(info.size),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  });
