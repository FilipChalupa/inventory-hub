/**
 * Wires the MCP authorization-server endpoints and the bearer-protected
 * `/mcp` transport endpoint onto the main Hono app.
 */
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { AppContext } from '../app.js';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { getMcpIssuer, getMcpResourceUrl } from '../env.js';
import type { EmailSender } from '../lib/email.js';
import { users } from '../db/schema.js';
import { createOauthRoutes } from './oauth-routes.js';
import { verifyAccessToken } from './oauth-store.js';
import { createMcpRuntime } from './server.js';
import type { McpPrincipal } from './principal.js';

/** Paths whose POST/PUT/DELETE requests must bypass CSRF (called by OAuth/MCP clients, not browsers). */
export const MCP_CSRF_EXEMPT_PREFIXES = ['/mcp', '/token', '/register', '/authorize/consent'];

export function isMcpCsrfExempt(path: string): boolean {
  return MCP_CSRF_EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

export function mountMcp(
  app: Hono<AppContext>,
  deps: { db: Db; env: Env; emailSender: EmailSender },
): void {
  const { db, env } = deps;
  const runtime = createMcpRuntime(deps);

  // OAuth AS + RS metadata endpoints, mounted at root.
  app.route('/', createOauthRoutes());

  // Bearer-protected MCP transport.
  app.all('/mcp', async (c) => {
    const resourceUrl = getMcpResourceUrl(env);
    const prmUrl = `${getMcpIssuer(env)}/.well-known/oauth-protected-resource`;
    const wwwAuth = `Bearer resource_metadata="${prmUrl}"`;
    const unauthorized = (description: string) =>
      c.json({ error: 'invalid_token', error_description: description }, 401, {
        'WWW-Authenticate': `${wwwAuth}, error="invalid_token", error_description="${description}"`,
      });

    const header = c.req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': wwwAuth });
    }
    const token = header.slice('Bearer '.length).trim();
    const verified = verifyAccessToken(db, token);
    if (!verified) return unauthorized('Token is invalid or expired.');

    // Audience binding (RFC 8707): token must have been issued for this server.
    if (verified.audience && verified.audience.replace(/\/$/, '') !== resourceUrl) {
      return unauthorized('Token audience does not match this resource.');
    }

    const user = db.select().from(users).where(eq(users.id, verified.userId)).get();
    if (!user || user.disabledAt) return unauthorized('User no longer active.');

    const principal: McpPrincipal = { user, scope: verified.scope };
    const authInfo: AuthInfo = {
      token,
      clientId: verified.clientId,
      scopes: verified.scope.split(/\s+/).filter(Boolean),
      expiresAt: verified.expiresAt,
      resource: new URL(resourceUrl),
      extra: { principal },
    };
    return runtime.handle(c.req.raw, authInfo);
  });
}
