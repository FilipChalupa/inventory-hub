import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { orgSettingsSchema } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { orgSettings } from '../db/schema.js';

const SINGLETON_ID = 'singleton';

export const orgRoutes = new Hono<AppContext>()
  .get('/', (c) => {
    const db = c.get('db');
    const row = db.select().from(orgSettings).where(eq(orgSettings.id, SINGLETON_ID)).get();
    if (!row) return c.json({ initialized: false }, 200);
    return c.json({
      initialized: true,
      settings: {
        name: row.name,
        codePrefix: row.codePrefix,
        allowedDomains: row.allowedDomains,
      },
    });
  })
  .put('/', zValidator('json', orgSettingsSchema), (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const now = new Date();
    db.insert(orgSettings)
      .values({
        id: SINGLETON_ID,
        name: input.name,
        codePrefix: input.codePrefix,
        allowedDomains: input.allowedDomains,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: orgSettings.id,
        set: {
          name: input.name,
          codePrefix: input.codePrefix,
          allowedDomains: input.allowedDomains,
          updatedAt: now,
        },
      })
      .run();
    return c.json({ ok: true });
  });
