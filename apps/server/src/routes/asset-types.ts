import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { customFieldsSchemaSchema } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { assetTypes } from '../db/schema.js';

const codePrefix = z
  .string()
  .min(1)
  .max(6)
  .regex(/^[A-Z0-9]+$/, 'Pouze A–Z a 0–9');

const createInput = z.object({
  name: z.string().min(1).max(200),
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
  .delete('/:id', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const result = db.delete(assetTypes).where(eq(assetTypes.id, id)).run();
    if (result.changes === 0) return c.json({ error: { message: 'Typ nenalezen' } }, 404);
    return c.json({ ok: true });
  });
