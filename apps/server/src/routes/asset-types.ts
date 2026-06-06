import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { customFieldsSchemaSchema } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { assetTypes } from '../db/schema.js';
import { parseCsv } from '../lib/csv.js';

const codePrefix = z
  .string()
  .trim()
  .min(1)
  .max(6)
  .regex(/^[A-Z0-9]+$/, 'Pouze A–Z a 0–9');

const createInput = z.object({
  name: z.string().trim().min(1).max(200),
  codePrefix,
  customFieldsSchema: customFieldsSchemaSchema.optional(),
});

const updateInput = z.object({
  name: z.string().min(1).max(200).optional(),
  codePrefix: codePrefix.optional(),
  customFieldsSchema: customFieldsSchemaSchema.optional(),
});

export const assetTypeRoutes = new Hono<AppContext>()
  .get('/', (c) => {
    const db = c.get('db');
    const items = db.select().from(assetTypes).orderBy(asc(assetTypes.name)).all();
    return c.json({ items });
  })
  .post('/', zValidator('json', createInput), (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const prefix = input.codePrefix.toUpperCase();

    const conflict = db
      .select({ id: assetTypes.id })
      .from(assetTypes)
      .where(eq(assetTypes.codePrefix, prefix))
      .get();
    if (conflict) {
      return c.json({ error: { message: `Prefix ${prefix} už existuje` } }, 409);
    }

    const id = crypto.randomUUID();
    db.insert(assetTypes)
      .values({
        id,
        name: input.name,
        codePrefix: prefix,
        customFieldsSchema: input.customFieldsSchema ?? [],
      })
      .run();
    return c.json({ id, name: input.name, codePrefix: prefix }, 201);
  })
  .patch('/:id', zValidator('json', updateInput), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const patch: Partial<typeof assetTypes.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) patch.name = input.name;
    if (input.codePrefix !== undefined) patch.codePrefix = input.codePrefix.toUpperCase();
    if (input.customFieldsSchema !== undefined) {
      patch.customFieldsSchema = input.customFieldsSchema;
    }
    const result = db.update(assetTypes).set(patch).where(eq(assetTypes.id, id)).run();
    if (result.changes === 0) return c.json({ error: { message: 'Typ nenalezen' } }, 404);
    return c.json({ ok: true });
  })
  .post('/import', async (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    if (user.role !== 'admin') {
      return c.json({ error: { message: 'Pouze admin může importovat typy' } }, 403);
    }
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: { message: 'Neplatná multipart data' } }, 400);
    }
    const file = form.get('file');
    const dryRun = form.get('dryRun') === 'true';
    if (!(file instanceof File)) {
      return c.json({ error: { message: 'Pole „file" je povinné' } }, 400);
    }
    if (file.size > 100_000) {
      return c.json({ error: { message: 'CSV soubor je větší než 100 KB' } }, 413);
    }
    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    if (!headers.includes('name') || !headers.includes('code_prefix')) {
      return c.json({ error: { message: 'CSV musí obsahovat sloupce: name, code_prefix' } }, 400);
    }
    if (rows.length === 0) {
      return c.json({ error: { message: 'CSV neobsahuje žádný řádek' } }, 400);
    }
    if (rows.length > 200) {
      return c.json({ error: { message: 'Maximálně 200 řádků' } }, 400);
    }

    const existingPrefixes = new Set(
      db.select({ p: assetTypes.codePrefix }).from(assetTypes).all().map((r) => r.p),
    );
    const seen = new Set<string>();
    const preview = rows.map((row, idx) => {
      const issues: string[] = [];
      const name = row['name'] ?? '';
      const prefix = (row['code_prefix'] ?? '').toUpperCase();
      if (!name) issues.push('Chybí name');
      if (!prefix) issues.push('Chybí code_prefix');
      else if (!/^[A-Z0-9]{1,6}$/.test(prefix)) {
        issues.push('code_prefix smí mít jen A–Z, 0–9, max 6 znaků');
      }
      if (prefix && existingPrefixes.has(prefix)) issues.push(`Prefix ${prefix} už existuje`);
      if (prefix && seen.has(prefix)) issues.push('Duplicitní code_prefix v CSV');
      if (prefix) seen.add(prefix);
      return { lineNumber: idx + 2, input: row, issues };
    });
    const hasErrors = preview.some((p) => p.issues.length > 0);

    if (dryRun || hasErrors) {
      return c.json({ preview, hasErrors, created: 0 }, hasErrors && !dryRun ? 400 : 200);
    }

    let created = 0;
    db.transaction((tx) => {
      for (const p of preview) {
        tx.insert(assetTypes)
          .values({
            id: crypto.randomUUID(),
            name: p.input['name']!,
            codePrefix: p.input['code_prefix']!.toUpperCase(),
            customFieldsSchema: [],
          })
          .run();
        created += 1;
      }
    });
    return c.json({ preview, hasErrors: false, created });
  })
  .delete('/:id', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const result = db.delete(assetTypes).where(eq(assetTypes.id, id)).run();
    if (result.changes === 0) return c.json({ error: { message: 'Typ nenalezen' } }, 404);
    return c.json({ ok: true });
  });
