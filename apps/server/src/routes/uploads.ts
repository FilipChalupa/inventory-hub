import { Hono } from 'hono';
import { mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, normalize } from 'node:path';
import type { AppContext } from '../app.js';
import { rateLimit } from '../lib/rate-limit.js';
import { ALLOWED_MIME, generateRelativePath, isInside, sniffMime } from '../lib/uploads.js';

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
            message: `Nepodporovaný typ souboru (${
              file.type || 'neznámý'
            }). Povoleno: JPEG, PNG, WebP, GIF, PDF`,
          },
        },
        415,
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    // The declared Content-Type must match the file's real magic bytes, so a
    // client can't store an executable/HTML payload under an allowed type.
    if (sniffMime(buf) !== file.type) {
      return c.json({ error: { message: 'Obsah souboru neodpovídá deklarovanému typu.' } }, 415);
    }

    const relative = generateRelativePath(ext);
    const absolute = resolve(env.UPLOAD_DIR, relative);
    if (!isInside(env.UPLOAD_DIR, absolute)) {
      return c.json({ error: { message: 'Neplatná cesta' } }, 400);
    }

    await mkdir(resolve(absolute, '..'), { recursive: true });
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
              : ext === 'pdf'
                ? 'application/pdf'
                : 'application/octet-stream';

    const data = await readFile(absolute);
    // Never let the browser sniff a served upload into a different type, and
    // force PDFs to download (they can carry active content / JS) while images
    // may render inline.
    const disposition = ext === 'pdf' ? `attachment; filename="${name}"` : 'inline';
    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(info.size),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': disposition,
      },
    });
  });
