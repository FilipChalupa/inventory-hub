import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { desc, eq } from 'drizzle-orm';
import { createApiKeyInput } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { apiKeys } from '../db/schema.js';
import { generateApiKey } from '../lib/apiKeys.js';
import { requireAuth } from '../middleware/auth.js';

// Managing API keys is admin-only; a key then authenticates as the admin
// who created it (same role/permissions).
export const apiKeyRoutes = new Hono<AppContext>()
  .use('*', requireAuth('admin'))
  .get('/', (c) => {
    const db = c.get('db');
    const rows = db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt))
      .all();
    return c.json({ items: rows });
  })
  .post('/', zValidator('json', createApiKeyInput), (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const user = c.get('user')!;
    const { token, hash, prefix } = generateApiKey();
    const id = crypto.randomUUID();
    db.insert(apiKeys)
      .values({
        id,
        name: input.name,
        prefix,
        tokenHash: hash,
        userId: user.id,
        expiresAt: input.expiresAt ?? null,
      })
      .run();
    // The raw token is returned exactly once — it is not recoverable later.
    return c.json({ id, name: input.name, prefix, token }, 201);
  })
  .delete('/:id', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const existing = db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, id)).get();
    if (!existing) return c.json({ error: { message: 'Klíč nenalezen' } }, 404);
    db.delete(apiKeys).where(eq(apiKeys.id, id)).run();
    return c.json({ ok: true });
  });
