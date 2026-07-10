import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import {
  orgSettingsSchema,
  labelSettingsSchema,
  DEFAULT_LABEL_SETTINGS,
} from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { orgSettings } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { getMcpResourceUrl } from '../env.js';

const SINGLETON_ID = 'singleton';

export const orgRoutes = new Hono<AppContext>()
  .get('/', (c) => {
    const db = c.get('db');
    // Public web app base URL — the root for human-facing deep links
    // (e.g. `${appUrl}/a/<code>`, `${appUrl}/loans/<id>`). Surfaced here so
    // API/MCP clients can build clickable links without guessing the host.
    const appUrl = c.get('env').PUBLIC_APP_URL.replace(/\/$/, '');
    const row = db.select().from(orgSettings).where(eq(orgSettings.id, SINGLETON_ID)).get();
    if (!row) {
      return c.json({ initialized: false, appUrl, labelSettings: DEFAULT_LABEL_SETTINGS }, 200);
    }
    return c.json({
      initialized: true,
      appUrl,
      settings: {
        name: row.name,
        codePrefix: row.codePrefix,
        allowedDomains: row.allowedDomains,
      },
      labelSettings: row.labelSettings ?? DEFAULT_LABEL_SETTINGS,
    });
  })
  // Connection details for the remote MCP server, surfaced in Settings so an
  // admin can wire up an AI assistant without digging through env/README.
  // `googleConfigured` gates the human OAuth login the MCP flow relies on.
  .get('/mcp-info', (c) => {
    const env = c.get('env');
    const googleConfigured = Boolean(
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URL,
    );
    return c.json({ url: getMcpResourceUrl(env), googleConfigured });
  })
  .put('/', requireAuth('admin'), zValidator('json', orgSettingsSchema), (c) => {
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
  })
  // Org-wide label-printer defaults. Separate from the main settings PUT so the
  // labels page can save them without resending name/prefix/domains.
  .put('/label-settings', requireAuth('admin'), zValidator('json', labelSettingsSchema), (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const row = db
      .select({ id: orgSettings.id })
      .from(orgSettings)
      .where(eq(orgSettings.id, SINGLETON_ID))
      .get();
    if (!row) {
      return c.json({ error: { message: 'Nejdřív vyplň základní nastavení organizace.' } }, 400);
    }
    db.update(orgSettings)
      .set({ labelSettings: input, updatedAt: new Date() })
      .where(eq(orgSettings.id, SINGLETON_ID))
      .run();
    return c.json({ ok: true });
  });
