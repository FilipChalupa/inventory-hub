import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { Db } from '../db/client.js';
import { locations } from '../db/schema.js';
import { parseCsv } from '../lib/csv.js';
import { requireAuth } from '../middleware/auth.js';

const createInput = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: z.string().uuid().nullable().optional(),
});

const updateInput = createInput.partial();

/**
 * True when moving `nodeId` under `newParentId` would create a cycle —
 * i.e. `newParentId` is `nodeId` itself or a descendant of `nodeId`.
 */
function wouldCreateCycle(db: Db, nodeId: string, newParentId: string): boolean {
  if (nodeId === newParentId) return true;
  const all = db.select({ id: locations.id, parentId: locations.parentId }).from(locations).all();
  const parentOf = new Map(all.map((r) => [r.id, r.parentId] as const));
  let cursor: string | null = newParentId;
  const guard = new Set<string>();
  while (cursor) {
    if (cursor === nodeId) return true;
    if (guard.has(cursor)) return true; // existing cycle — treat as unsafe
    guard.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

export const locationRoutes = new Hono<AppContext>()
  .get('/', (c) => {
    const db = c.get('db');
    const items = db.select().from(locations).orderBy(asc(locations.name)).all();
    return c.json({ items });
  })
  .post('/', requireAuth('admin', 'operator'), zValidator('json', createInput), (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const id = crypto.randomUUID();
    db.insert(locations)
      .values({ id, name: input.name, parentId: input.parentId ?? null })
      .run();
    return c.json({ id, name: input.name, parentId: input.parentId ?? null }, 201);
  })
  .patch('/:id', requireAuth('admin', 'operator'), zValidator('json', updateInput), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const input = c.req.valid('json');
    if (input.parentId !== undefined && input.parentId !== null) {
      const parent = db.select().from(locations).where(eq(locations.id, input.parentId)).get();
      if (!parent) return c.json({ error: { message: 'Cílová lokace neexistuje' } }, 400);
      if (wouldCreateCycle(db, id, input.parentId)) {
        return c.json({ error: { message: 'Přesun by vytvořil cyklus' } }, 409);
      }
    }
    const result = db
      .update(locations)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(locations.id, id))
      .run();
    if (result.changes === 0) return c.json({ error: { message: 'Lokace nenalezena' } }, 404);
    return c.json({ ok: true });
  })
  .post('/import', requireAuth('admin', 'operator'), async (c) => {
    const db = c.get('db');
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
    if (!headers.includes('name')) {
      return c.json({ error: { message: 'CSV musí obsahovat sloupec: name' } }, 400);
    }
    if (rows.length === 0) {
      return c.json({ error: { message: 'CSV neobsahuje žádný řádek' } }, 400);
    }
    if (rows.length > 500) {
      return c.json({ error: { message: 'Maximálně 500 řádků' } }, 400);
    }

    // Look up by case-insensitive name. Existing locations are matched
    // exactly to avoid surprising the user.
    const existingByName = new Map<string, string>(); // lower(name) → id
    for (const row of db.select({ id: locations.id, name: locations.name }).from(locations).all()) {
      existingByName.set(row.name.toLowerCase(), row.id);
    }

    type PreviewRow = {
      lineNumber: number;
      input: Record<string, string>;
      resolvedParentId: string | null;
      issues: string[];
    };
    const preview: PreviewRow[] = [];
    const namesInRun = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const issues: string[] = [];
      const name = (row['name'] ?? '').trim();
      const parentName = (row['parent_name'] ?? '').trim();
      let resolvedParentId: string | null = null;
      if (!name) issues.push('Chybí name');
      if (name && namesInRun.has(name.toLowerCase())) issues.push('Duplicitní name v CSV');
      else if (name) namesInRun.add(name.toLowerCase());
      if (parentName) {
        const parentId = existingByName.get(parentName.toLowerCase());
        if (!parentId) issues.push(`Nadřazená lokace „${parentName}" neexistuje`);
        else resolvedParentId = parentId;
      }
      preview.push({ lineNumber: i + 2, input: row, resolvedParentId, issues });
    }
    const hasErrors = preview.some((p) => p.issues.length > 0);
    if (dryRun || hasErrors) {
      return c.json({ preview, hasErrors, created: 0 }, hasErrors && !dryRun ? 400 : 200);
    }

    let created = 0;
    db.transaction((tx) => {
      for (const p of preview) {
        tx.insert(locations)
          .values({
            id: crypto.randomUUID(),
            name: p.input['name']!.trim(),
            parentId: p.resolvedParentId,
          })
          .run();
        created += 1;
      }
    });
    return c.json({ preview, hasErrors: false, created });
  })
  .delete('/:id', requireAuth('admin'), (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const result = db.delete(locations).where(eq(locations.id, id)).run();
    if (result.changes === 0) return c.json({ error: { message: 'Lokace nenalezena' } }, 404);
    return c.json({ ok: true });
  });
