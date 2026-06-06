/**
 * Internal dispatch app for MCP tools.
 *
 * Rather than re-implement ~50 operations, MCP tools call the *existing* Hono
 * routers in-process. This second Hono instance mounts the same routers as the
 * public API, but swaps cookie-session auth for the AsyncLocalStorage principal
 * and skips CSRF (which only guards cross-origin browser requests). Every bit
 * of validation, role-gating and transactional logic is reused verbatim.
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Db } from './../db/client.js';
import type { Env } from './../env.js';
import type { EmailSender } from './../lib/email.js';
import type { AppContext } from '../app.js';
import { requireAuth } from '../middleware/auth.js';
import { orgRoutes } from '../routes/org.js';
import { assetRoutes } from '../routes/assets.js';
import { assetTypeRoutes } from '../routes/asset-types.js';
import { locationRoutes } from '../routes/locations.js';
import { damageRoutes } from '../routes/damages.js';
import { loanRoutes } from '../routes/loans.js';
import { uploadRoutes } from '../routes/uploads.js';
import { exportRoutes } from '../routes/export.js';
import { invitationRoutes } from '../routes/invitations.js';
import { userRoutes } from '../routes/users.js';
import { contactRoutes } from '../routes/contacts.js';
import { currentPrincipal } from './principal.js';

export type McpDispatchApp = Hono<AppContext>;

export function createMcpDispatchApp(deps: {
  db: Db;
  env: Env;
  emailSender: EmailSender;
}): McpDispatchApp {
  const app = new Hono<AppContext>();

  app.use('*', async (c, next) => {
    c.set('db', deps.db);
    c.set('env', deps.env);
    c.set('emailSender', deps.emailSender);
    const principal = currentPrincipal();
    if (principal) c.set('user', principal.user);
    await next();
  });

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

  app.onError((err, c) => {
    const status = err instanceof HTTPException ? err.status : 500;
    if (!(err instanceof HTTPException)) console.error('MCP dispatch error:', err);
    return c.json({ error: { message: err.message } }, status);
  });

  return app;
}

export type ApiResult = { status: number; ok: boolean; body: unknown };

/**
 * Calls an API route on the dispatch app in-process. `path` is the full route
 * path including `/api/...` and any query string. Must run inside
 * `runWithPrincipal(...)` so the routers see an authenticated user.
 */
export async function callApi(
  app: McpDispatchApp,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult> {
  const init: RequestInit = { method };
  if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  // Host is arbitrary for in-process dispatch; routers only read path/query.
  const res = await app.request(`http://mcp.internal${path}`, init);
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, ok: res.ok, body: parsed };
}
