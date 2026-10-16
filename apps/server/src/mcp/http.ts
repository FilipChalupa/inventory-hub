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
import { clientIp, hitRateLimit, rateLimit } from '../lib/rate-limit.js';
import { getClient, touchToken, verifyAccessToken } from './oauth-store.js';
import { createMcpRuntime } from './server.js';
import { bodyLimit } from 'hono/body-limit';
import { saveUploadBuffer, sniffMime } from '../lib/uploads.js';
import { callApi, createMcpDispatchApp } from './dispatch.js';
import { runWithPrincipal } from './principal.js';
import { consumeUploadLink, getUploadLink } from './upload-links.js';
import { MCP_DISABLED_MESSAGE, getMcpPolicy } from './policy.js';
import type { McpPrincipal } from './principal.js';

const MCP_IP_LIMIT = { bucket: 'mcp-ip', windowMs: 60_000, max: 1200 };

/** Paths whose POST/PUT/DELETE requests must bypass CSRF (called by OAuth/MCP clients, not browsers). */
export const MCP_CSRF_EXEMPT_PREFIXES = [
  '/mcp',
  '/token',
  '/register',
  '/authorize/consent',
  // One-time upload links (curl from an agent; the token is the credential).
  '/upload',
];

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

  // One-time upload links minted by the create_upload_link tool. The token
  // is the credential; the file is stored and attached as the user (and
  // agent) that created the link, through the same routers MCP tools use.
  const dispatch = createMcpDispatchApp(deps);
  app.post(
    '/upload/:token',
    rateLimit({ bucket: 'upload-link', windowMs: 60_000, max: 30 }),
    bodyLimit({
      maxSize: env.UPLOAD_MAX_BYTES * 2,
      onError: (c) => c.json({ error: { message: 'File too large.' } }, 413),
    }),
    async (c) => {
      const token = c.req.param('token');
      const link = getUploadLink(token);
      if (!link)
        return c.json({ error: { message: 'Upload link is invalid, used or expired.' } }, 404);
      const user = db.select().from(users).where(eq(users.id, link.userId)).get();
      if (!user || user.disabledAt) {
        return c.json({ error: { message: 'User no longer active.' } }, 403);
      }
      if (!getMcpPolicy(db).enabled) {
        return c.json({ error: { message: MCP_DISABLED_MESSAGE } }, 403);
      }

      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return c.json({ error: { message: 'Send the file as multipart form field "file".' } }, 400);
      }
      const file = form.get('file');
      if (!(file instanceof File)) {
        return c.json({ error: { message: 'Send the file as multipart form field "file".' } }, 400);
      }
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.byteLength > env.UPLOAD_MAX_BYTES) {
        return c.json({ error: { message: `File exceeds ${env.UPLOAD_MAX_BYTES} bytes.` } }, 413);
      }
      // Type comes from the bytes, not the client's claim.
      const mime = sniffMime(buf);
      const wantsImage = link.purpose.kind !== 'asset_document';
      if (!mime || (wantsImage && !mime.startsWith('image/'))) {
        return c.json(
          {
            error: {
              message: wantsImage
                ? 'Not a supported image (JPEG, PNG, WebP, GIF).'
                : 'Unsupported file type (JPEG, PNG, WebP, GIF, PDF).',
            },
          },
          415,
        );
      }
      const path = await saveUploadBuffer(env, buf, mime);
      if (!path) return c.json({ error: { message: 'Could not store the file.' } }, 500);

      const principal: McpPrincipal = { user, scope: link.scope, agentName: link.agentName };
      const purpose = link.purpose;
      if (purpose.kind === 'damage_photo') {
        consumeUploadLink(token);
        return c.json({ ok: true, path });
      }
      const route = purpose.kind === 'asset_photo' ? 'photos' : 'documents';
      const attached = await runWithPrincipal(principal, () =>
        callApi(dispatch, 'POST', `/api/assets/${encodeURIComponent(purpose.code)}/${route}`, {
          path,
        }),
      );
      if (!attached.ok) {
        const msg = (attached.body as { error?: { message?: string } })?.error?.message;
        return c.json({ error: { message: msg ?? 'Attaching failed.' } }, attached.status as 400);
      }
      consumeUploadLink(token);
      return c.json({ ok: true, path, attachedTo: purpose.code, ...(attached.body as object) });
    },
  );

  // Bearer-protected MCP transport.
  app.all('/mcp', async (c) => {
    const resourceUrl = getMcpResourceUrl(env);
    const prmUrl = `${getMcpIssuer(env)}/.well-known/oauth-protected-resource`;
    const wwwAuth = `Bearer resource_metadata="${prmUrl}"`;
    const tooMany = (retryAfter: number) =>
      c.json(
        {
          error: 'rate_limited',
          error_description: `Too many requests; retry in ${retryAfter}s.`,
        },
        429,
        { 'Retry-After': String(retryAfter) },
      );
    const unauthorized = (description: string) =>
      c.json({ error: 'invalid_token', error_description: description }, 401, {
        'WWW-Authenticate': `${wwwAuth}, error="invalid_token", error_description="${description}"`,
      });

    // Per-IP backstop before any token lookup (tokens are 256-bit, so this is
    // about load, not guessing).
    const ipLimited = hitRateLimit(MCP_IP_LIMIT, clientIp(c.req.raw.headers));
    if (ipLimited) return tooMany(ipLimited.retryAfter);

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
    if (!getMcpPolicy(db).enabled) {
      return c.json({ error: 'mcp_disabled', error_description: MCP_DISABLED_MESSAGE }, 403);
    }

    // Per-connection budget: a looping agent is throttled on its own.
    const limited = hitRateLimit(
      { bucket: 'mcp-token', windowMs: 60_000, max: env.MCP_RATE_LIMIT_PER_MIN },
      verified.id,
    );
    if (limited) return tooMany(limited.retryAfter);
    touchToken(db, verified.id);

    const agentName =
      verified.kind === 'personal'
        ? (verified.name ?? 'MCP token')
        : (getClient(db, verified.clientId)?.clientName ?? 'MCP client');
    const principal: McpPrincipal = { user, scope: verified.scope, agentName };
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
