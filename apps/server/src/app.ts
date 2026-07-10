import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
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
import { feedRoutes } from './routes/feeds.js';
import { inventoryRoutes } from './routes/inventory.js';
import { uploadRoutes } from './routes/uploads.js';
import { exportRoutes } from './routes/export.js';
import { importRoutes } from './routes/import.js';
import { invitationRoutes } from './routes/invitations.js';
import { userRoutes } from './routes/users.js';
import { contactRoutes } from './routes/contacts.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { authRoutes } from './routes/auth.js';
import { authLoader, requireAuth } from './middleware/auth.js';
import { isMcpCsrfExempt, mountMcp } from './mcp/http.js';
import {
  openApiDocument,
  DOCS_HTML,
  SWAGGER_INIT_JS,
  SWAGGER_UI_DIR,
  SWAGGER_UI_FILES,
} from './lib/openapi.js';
import { join } from 'node:path';

export type AppContext = {
  Variables: {
    db: Db;
    env: Env;
    emailSender: EmailSender;
    user?: UserRow;
    requestId: string;
  };
};

/** Redacts the `?token=…` calendar-feed secret from a path before logging. */
function redactToken(path: string): string {
  return path.replace(/([?&]token=)[^&\s]+/gi, '$1[redacted]');
}

export function createApp(deps: { db: Db; env: Env; emailSender?: EmailSender }) {
  const app = new Hono<AppContext>();
  const emailSender = deps.emailSender ?? createEmailSender(deps.env);

  // Request ID: reuse an inbound `X-Request-Id` (e.g. from a reverse proxy)
  // or mint one, expose it on the context and echo it on the response so a
  // log line can be correlated with a client-visible id.
  app.use('*', async (c, next) => {
    const inbound = c.req.header('x-request-id');
    const requestId = inbound && inbound.length <= 200 ? inbound : crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    await next();
  });

  // Access log: one line per request tagged with the request id, HTTP method,
  // path, status and duration. The calendar feed carries its API key as
  // `?token=…` (clients can't send headers), so redact it; Bearer keys live in
  // headers, which aren't logged.
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    const url = new URL(c.req.url);
    const path = redactToken(url.pathname + url.search);
    console.log(`[${c.get('requestId')}] ${c.req.method} ${path} ${c.res.status} ${ms}ms`);
  });
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

  // Security response headers on every response. CSP is deliberately tuned for
  // this app rather than locked to defaults:
  //  - script-src 'self': the SPA loads only its own bundled JS (Vite emits
  //    external module scripts; the Swagger init is externalised too), so no
  //    'unsafe-inline'/'unsafe-eval' is needed.
  //  - style-src allows 'unsafe-inline' because the Vite build and the styled
  //    error page inject inline <style>/style attributes.
  //  - img-src allows data: and blob: for QR codes, camera captures and
  //    locally-previewed photos before upload.
  //  - connect-src 'self': the frontend talks only to this same origin.
  //  - frame-ancestors 'none' + X-Frame-Options: DENY: no embedding anywhere.
  // Google OAuth uses a top-level redirect (not a popup/iframe), so none of
  // these directives interfere with the login flow.
  app.use(
    '*',
    secureHeaders({
      xFrameOptions: 'DENY',
      xContentTypeOptions: 'nosniff',
      referrerPolicy: 'strict-origin-when-cross-origin',
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    }),
  );

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

  // Public, machine-readable API description for integrators + a self-hosted
  // Swagger UI (no external CDN).
  app.get('/openapi.json', (c) => c.json(openApiDocument()));
  app.get('/docs', (c) => c.html(DOCS_HTML));
  // Externalised Swagger bootstrap (kept out of the HTML so CSP script-src can
  // stay 'self'). Registered before the generic /docs/:file handler.
  app.get('/docs/swagger-initializer.js', (c) =>
    c.body(SWAGGER_INIT_JS, 200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    }),
  );
  app.get('/docs/:file', (c) => {
    const file = c.req.param('file');
    // Defense in depth on top of the whitelist below: a docs asset is always
    // a bare filename, so reject anything with a path separator or traversal
    // (e.g. the encoded `/docs/..%2f..%2fpackage.json`) before touching the FS.
    if (file.includes('/') || file.includes('\\') || file.includes('..')) {
      return c.notFound();
    }
    const contentType = SWAGGER_UI_FILES[file];
    if (!contentType) return c.notFound();
    try {
      const body = readFileSync(join(SWAGGER_UI_DIR, file), 'utf8');
      return c.body(body, 200, {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400',
      });
    } catch {
      return c.notFound();
    }
  });

  // Subscribable calendar feeds — authenticate via `?token=<api key>`, so they
  // sit outside the session-guarded /api/* surface (mounted before the SPA).
  app.route('/feeds', feedRoutes);

  // All /api/* routes require an authenticated session. Org PUT additionally
  // requires admin role — handled inside the org router.
  app.use('/api/*', requireAuth());

  // Role model (enforced per-route with `requireAuth(...roles)` in each router):
  //  - admin:    everything, including destructive deletes (asset type,
  //              location, contact, loan) and privileged imports.
  //  - operator: all inventory mutations (create/update/patch/archive/repair/
  //              assign/external-ids, loans, inventory sessions, damage
  //              resolve, bulk import) but NOT the admin-only deletes above.
  //  - member:   read-only across the API, plus may file a damage report
  //              (POST /api/damages/by-asset/:code) and upload its photo.
  //  - auditor:  read-only everywhere (enforced globally just below).
  // GET stays open to any authenticated role; mutations carry an explicit
  // `requireAuth('admin', ...)` / `requireAuth('admin', 'operator')` guard.

  // `auditor` is a read-only role: reject any state-changing request across the
  // whole API in one place, rather than role-guarding every mutation route.
  app.use('/api/*', async (c, next) => {
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const user = c.get('user') as UserRow | undefined;
      if (user?.role === 'auditor') {
        return c.json({ error: { message: 'Auditor má jen čtecí přístup' } }, 403);
      }
    }
    return next();
  });

  app.route('/api/org', orgRoutes);
  app.route('/api/assets', assetRoutes);
  app.route('/api/asset-types', assetTypeRoutes);
  app.route('/api/locations', locationRoutes);
  app.route('/api/damages', damageRoutes);
  app.route('/api/loans', loanRoutes);
  app.route('/api/inventory', inventoryRoutes);
  app.route('/api/uploads', uploadRoutes);
  app.route('/api/export', exportRoutes);
  app.route('/api/import', importRoutes);
  app.route('/api/invitations', invitationRoutes);
  app.route('/api/users', userRoutes);
  app.route('/api/contacts', contactRoutes);
  app.route('/api/api-keys', apiKeyRoutes);

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
    if (!(err instanceof HTTPException))
      console.error(`[${c.get('requestId')}] Request error:`, err);

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
    // Never leak internal error details (stack-adjacent messages, SQL, paths)
    // to API clients. HTTPExceptions are deliberate, client-safe messages;
    // anything else is an unexpected 500 and gets a generic body (the real
    // error is logged above).
    const message = err instanceof HTTPException ? err.message : 'Interní chyba serveru';
    return c.json({ error: { message } }, status);
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
