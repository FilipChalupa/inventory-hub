import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import type { UserRow } from './db/schema.js';
import { createEmailSender, type EmailSender } from './lib/email.js';
import { renderErrorPage } from './lib/error-page.js';
import { healthRoutes } from './routes/health.js';
import { orgRoutes } from './routes/org.js';
import { assetRoutes } from './routes/assets.js';
import { assetTypeRoutes } from './routes/asset-types.js';
import { locationRoutes } from './routes/locations.js';
import { damageRoutes } from './routes/damages.js';
import { loanRoutes } from './routes/loans.js';
import { uploadRoutes } from './routes/uploads.js';
import { exportRoutes } from './routes/export.js';
import { invitationRoutes } from './routes/invitations.js';
import { userRoutes } from './routes/users.js';
import { contactRoutes } from './routes/contacts.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { authRoutes } from './routes/auth.js';
import { authLoader, requireAuth } from './middleware/auth.js';
import { isMcpCsrfExempt, mountMcp } from './mcp/http.js';
import { openApiDocument, DOCS_HTML } from './lib/openapi.js';
// TODO: Dočasné – odebrat import a registraci demoRoutes před finálním releasem.
import { demoRoutes } from './routes/demo.js';

export type AppContext = {
  Variables: {
    db: Db;
    env: Env;
    emailSender: EmailSender;
    user?: UserRow;
  };
};

export function createApp(deps: { db: Db; env: Env; emailSender?: EmailSender }) {
  const app = new Hono<AppContext>();
  const emailSender = deps.emailSender ?? createEmailSender(deps.env);

  app.use('*', logger());
  app.use('*', cors({ origin: deps.env.PUBLIC_APP_URL, credentials: true }));
  // CSRF: rejects state-changing requests whose Origin/Sec-Fetch-Site
  // doesn't match our public URL. Cookies are SameSite=Lax which already
  // blocks most CSRF, this is belt-and-suspenders. Skipped for /health,
  // the OAuth callback (cross-origin redirect from Google), and the MCP /
  // OAuth-AS endpoints (called by MCP clients/backends, not browsers).
  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    // Bearer (API key / OAuth) requests don't ride on cookies, so CSRF —
    // an Origin-based defense for browser cookie auth — doesn't apply.
    const isBearer = c.req.header('authorization')?.startsWith('Bearer ');
    if (
      path === '/health' ||
      path.startsWith('/auth/google/') ||
      isMcpCsrfExempt(path) ||
      isBearer
    ) {
      return next();
    }
    return csrf({ origin: deps.env.PUBLIC_APP_URL })(c, next);
  });

  app.use('*', async (c, next) => {
    c.set('db', deps.db);
    c.set('env', deps.env);
    c.set('emailSender', emailSender);
    await next();
  });

  // Loads the session if one is present, but doesn't enforce auth.
  app.use('*', authLoader);

  app.route('/health', healthRoutes);
  app.route('/auth', authRoutes);

  // Public, machine-readable API description for integrators + a docs UI.
  app.get('/openapi.json', (c) => c.json(openApiDocument()));
  app.get('/docs', (c) => c.html(DOCS_HTML));

  // All /api/* routes require an authenticated session. Org PUT additionally
  // requires admin role — handled inside the org router.
  app.use('/api/*', requireAuth());
  app.route('/api/org', orgRoutes);
  app.route('/api/assets', assetRoutes);
  app.route('/api/asset-types', assetTypeRoutes);
  app.route('/api/locations', locationRoutes);
  app.route('/api/damages', damageRoutes);
  app.route('/api/loans', loanRoutes);
  app.route('/api/uploads', uploadRoutes);
  app.route('/api/export', exportRoutes);
  app.route('/api/invitations', invitationRoutes);
  app.route('/api/users', userRoutes);
  app.route('/api/contacts', contactRoutes);
  app.route('/api/api-keys', apiKeyRoutes);
  // TODO: Dočasné – odebrat před finálním releasem.
  app.route('/api/demo', demoRoutes);

  // Remote MCP server: OAuth 2.1 authorization-server + resource-server
  // endpoints (well-known metadata, /register, /authorize, /token) and the
  // bearer-protected /mcp transport. Mounted before the SPA fallback so its
  // GET routes (/authorize, /.well-known/*) take precedence.
  mountMcp(app, { db: deps.db, env: deps.env, emailSender });

  // Serve the built SPA when the dist directory is present (production
  // image, single-container deploy). In dev the dist doesn't exist and we
  // skip — Vite serves the frontend separately on port 5173.
  const spaRoot = findSpaRoot();
  if (spaRoot) {
    app.use('/*', serveStatic({ root: spaRoot.serveRoot }));
    // SPA fallback: anything that wasn't an API/auth/health route nor a
    // real file in dist should serve index.html so client-side routing
    // works on deep links + reloads.
    app.get('/*', (c) => {
      const indexPath = resolve(spaRoot.absoluteRoot, 'index.html');
      if (!existsSync(indexPath)) return c.notFound();
      return c.html(readFileSyncCached(indexPath));
    });
  }

  app.onError((err, c) => {
    const status = err instanceof HTTPException ? err.status : 500;
    if (!(err instanceof HTTPException)) console.error('Request error:', err);

    // Browser navigations (non-API GETs that accept text/html) get a styled
    // HTML page; the SPA and API clients keep getting JSON.
    const path = new URL(c.req.url).pathname;
    const wantsHtml =
      !path.startsWith('/api/') && (c.req.header('accept') ?? '').includes('text/html');
    if (wantsHtml) {
      const message =
        err instanceof HTTPException ? err.message : 'Na serveru došlo k neočekávané chybě.';
      return c.html(renderErrorPage(status, message, { homeUrl: deps.env.PUBLIC_APP_URL }), status);
    }
    return c.json({ error: { message: err.message } }, status);
  });

  return app;
}

/**
 * Locates the built SPA's dist directory across dev (`tsx` from
 * apps/server) and production (`node apps/server/dist/index.js` from
 * /app) layouts. Returns both the absolute path (for fs reads) and the
 * relative path serveStatic needs (resolved against process.cwd()).
 */
function findSpaRoot(): { absoluteRoot: string; serveRoot: string } | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../web/dist'), // production: /app/apps/server/dist/app.js
    resolve(here, '../../../web/dist'), // dev fallback (src/app.ts)
  ];
  for (const abs of candidates) {
    if (existsSync(resolve(abs, 'index.html'))) {
      const rel = relativeFromCwd(abs);
      return { absoluteRoot: abs, serveRoot: rel };
    }
  }
  return null;
}

function relativeFromCwd(absolute: string): string {
  const cwd = process.cwd();
  if (absolute.startsWith(cwd + '/')) return absolute.slice(cwd.length + 1);
  return absolute;
}

// Tiny module-level cache so we don't re-read index.html on every request.
let indexHtmlCache: { path: string; body: string } | null = null;
function readFileSyncCached(path: string): string {
  if (!indexHtmlCache || indexHtmlCache.path !== path) {
    indexHtmlCache = { path, body: readFileSync(path, 'utf8') };
  }
  return indexHtmlCache.body;
}
