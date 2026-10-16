import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, normalize } from 'node:path';
import type { AppContext } from '../app.js';
import { rateLimit } from '../lib/rate-limit.js';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  ALLOWED_MIME,
  generateRelativePath,
  isInside,
  saveUploadBuffer,
  sniffMime,
  storeRemoteFile,
} from '../lib/uploads.js';

// JSON alternative to the multipart upload, for API/MCP clients that hold a
// file as base64 or only know its public URL. Exactly one of the two.
const importInput = z
  .object({
    dataBase64: z.string().min(1).optional(),
    url: z.string().url().optional(),
  })
  .refine((v) => Boolean(v.dataBase64) !== Boolean(v.url), {
    message: 'Pošli buď dataBase64, nebo url.',
  });

/**
 * Caps the request body while it streams in (Content-Length can be absent or
 * lie), so an oversized upload is cut off instead of buffered. 2× the file
 * limit leaves room for multipart framing and base64's 4/3 overhead.
 */
const uploadBodyLimit = createMiddleware<AppContext>((c, next) =>
  bodyLimit({
    maxSize: c.get('env').UPLOAD_MAX_BYTES * 2,
    onError: (c) =>
      c.json(
        { error: { message: `Soubor je větší než limit ${c.get('env').UPLOAD_MAX_BYTES} B` } },
        413,
      ),
  })(c, next),
);

export const uploadRoutes = new Hono<AppContext>()
  .use('/', uploadBodyLimit)
  .use('/import', uploadBodyLimit)
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
  .post(
    '/import',
    rateLimit({ bucket: 'uploads', windowMs: 60_000, max: 60 }),
    zValidator('json', importInput),
    async (c) => {
      const env = c.get('env');
      const input = c.req.valid('json');
      let path: string | null;
      if (input.dataBase64) {
        // Strip an optional data: URL prefix; base64 is ~4/3 of the payload.
        const b64 = input.dataBase64.replace(/^data:[^,]*,/, '');
        if (b64.length > Math.ceil((env.UPLOAD_MAX_BYTES * 4) / 3) + 4) {
          return c.json(
            { error: { message: `Soubor je větší než limit ${env.UPLOAD_MAX_BYTES} B` } },
            413,
          );
        }
        const buf = Buffer.from(b64, 'base64');
        const mime = sniffMime(buf);
        if (!mime) {
          return c.json(
            {
              error: { message: 'Nepodporovaný typ souboru. Povoleno: JPEG, PNG, WebP, GIF, PDF' },
            },
            415,
          );
        }
        path = await saveUploadBuffer(env, buf, mime);
      } else {
        // Public http(s) only (SSRF guard), size-capped, type from magic bytes.
        path = await storeRemoteFile(env, input.url!, 0);
      }
      if (!path) {
        return c.json(
          {
            error: {
              message:
                'Soubor se nepodařilo uložit (nedostupná nebo neveřejná URL, nepodporovaný typ, nebo příliš velký).',
            },
          },
          422,
        );
      }
      const ext = path.slice(path.lastIndexOf('.') + 1);
      const contentType = [...ALLOWED_MIME].find(([, e]) => e === ext)?.[0];
      return c.json({ path, url: `/api/uploads/${path}`, contentType });
    },
  )
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
