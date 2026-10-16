/**
 * OAuth 2.1 authorization-server + resource-server HTTP endpoints for MCP,
 * implemented natively in Hono (the SDK's auth router targets Express).
 *
 * Endpoints:
 *  - GET  /.well-known/oauth-protected-resource   (RFC 9728)
 *  - GET  /.well-known/oauth-authorization-server  (RFC 8414)
 *  - POST /register                                (RFC 7591 dynamic registration)
 *  - GET  /authorize                               (consent + scope choice + Google login bridge)
 *  - POST /authorize/consent                       (form submit → authorization code)
 *  - POST /token                                   (code → tokens; refresh rotation)
 *
 * The human is authenticated by reusing the existing session cookie; if absent,
 * the user is bounced through the existing Google login and returned here.
 */
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { getMcpIssuer, getMcpResourceUrl } from '../env.js';
import type { Env } from '../env.js';
import { renderErrorPage } from '../lib/error-page.js';
import { requestLocale, type UiLocale } from '../lib/request-locale.js';
import { rateLimit } from '../lib/rate-limit.js';
import { SESSION_COOKIE, loadSession } from '../lib/sessions.js';
import {
  SCOPE_READ,
  SCOPE_WRITE,
  consumeAuthorizationCode,
  createAuthorizationCode,
  getClient,
  issueTokens,
  registerClient,
  rotateRefreshToken,
  scopeAllowsWrite,
  scopeStringFor,
  verifyClientSecret,
  verifyPkce,
  type ReusedRefreshToken,
} from './oauth-store.js';
import { recordMcpEvent } from './connections.js';
import { notifyAgentConnected, notifyAgentRevokedForReuse } from './notify.js';
import { getMcpPolicy, roleMayWrite } from './policy.js';

// Cookie capturing a pending /authorize request across the Google login
// round-trip. The auth callback in routes/auth.ts honours it. Keep this string
// in sync with that handler.
export const MCP_PENDING_AUTHORIZE_COOKIE = 'mcp_pending_authorize';

function isSecure(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Redirect back to the client with an OAuth error (RFC 6749 §4.1.2.1). */
function errorRedirect(redirectUri: string, error: string, description: string, state?: string) {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  return u.toString();
}

const consentPageCss = `
  body{font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;margin:0;padding:2rem;color:#1a1a1a}
  .card{max-width:30rem;margin:3rem auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{color:#555;line-height:1.5}
  .scopes{margin:1.5rem 0;display:flex;flex-direction:column;gap:.75rem}
  label.opt{display:flex;gap:.6rem;align-items:flex-start;border:1px solid #e2e4e8;border-radius:8px;padding:.75rem 1rem;cursor:pointer}
  label.opt:has(input:checked){border-color:#2563eb;background:#eff4ff}
  .opt strong{display:block}
  .opt span{color:#666;font-size:.9rem}
  .hint{font-size:.85rem;color:#777}
  .actions{display:flex;gap:.75rem;margin-top:1.5rem}
  button{flex:1;padding:.7rem 1rem;border-radius:8px;border:0;font-size:1rem;cursor:pointer}
  .approve{background:#2563eb;color:#fff}
  .deny{background:#e8eaed;color:#333}
`;

const CONSENT_COPY = {
  cs: {
    connect: (app: string) => `Připojit ${app}`,
    unknownApp: 'Neznámá aplikace',
    asks: (app: string, email: string) =>
      `Aplikace <strong>${app}</strong> žádá o přístup k Inventory Hubu jako <strong>${email}</strong>.`,
    readWrite: 'Čtení i zápis',
    readWriteHint: 'Plný přístup v rozsahu tvé role (vytváření výpůjček, úpravy…).',
    read: 'Jen čtení',
    readHint: 'Aplikace může jen číst data, nic neměnit.',
    manageHint: 'Připojení můžeš kdykoli odpojit na stránce AI asistenti v aplikaci.',
    deny: 'Odmítnout',
    approve: 'Povolit',
    badRequest: 'Neplatný autorizační požadavek.',
    unknownClient: 'Neznámý klient (client_id).',
    redirectMismatch: 'redirect_uri neodpovídá registrovanému klientovi.',
    incomplete: 'Neúplný požadavek.',
    badClient: 'Neplatný klient nebo redirect_uri.',
    sessionExpired: 'Přihlášení vypršelo. Zkus to prosím znovu.',
    disabled: 'Připojování AI asistentů (MCP) administrátor v této organizaci vypnul.',
    readOnlyByPolicy: 'Administrátor pro tvou roli povolil jen čtení.',
  },
  en: {
    connect: (app: string) => `Connect ${app}`,
    unknownApp: 'Unknown application',
    asks: (app: string, email: string) =>
      `<strong>${app}</strong> is requesting access to Inventory Hub as <strong>${email}</strong>.`,
    readWrite: 'Read & write',
    readWriteHint: 'Full access within your role (creating loans, editing…).',
    read: 'Read only',
    readHint: 'The application can only read data, never change it.',
    manageHint: 'You can disconnect it at any time on the AI assistants page in the app.',
    deny: 'Deny',
    approve: 'Allow',
    badRequest: 'Invalid authorization request.',
    unknownClient: 'Unknown client (client_id).',
    redirectMismatch: 'redirect_uri does not match the registered client.',
    incomplete: 'Incomplete request.',
    badClient: 'Invalid client or redirect_uri.',
    sessionExpired: 'Your sign-in expired. Please try again.',
    disabled:
      'An administrator has turned off AI-assistant (MCP) connections for this organization.',
    readOnlyByPolicy: 'Your administrator allows read-only access for your role.',
  },
} satisfies Record<UiLocale, unknown>;

function renderConsent(opts: {
  locale: UiLocale;
  clientName: string;
  userEmail: string;
  hidden: Record<string, string>;
  allowWrite: boolean;
}): string {
  const t = CONSENT_COPY[opts.locale];
  const app = escapeHtml(opts.clientName);
  const hiddenInputs = Object.entries(opts.hidden)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('');
  // Read-only is preselected: least privilege unless the user opts into writes.
  return `<!doctype html><html lang="${opts.locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.connect(app)}</title><style>${consentPageCss}</style></head>
<body><div class="card">
<h1>${t.connect(app)}</h1>
<p>${t.asks(app, escapeHtml(opts.userEmail))}</p>
<form method="post" action="/authorize/consent">
${hiddenInputs}
<div class="scopes">
  <label class="opt"><input type="radio" name="grant" value="read" checked>
    <span><strong>${t.read}</strong><span>${t.readHint}</span></span></label>
  ${
    opts.allowWrite
      ? `<label class="opt"><input type="radio" name="grant" value="read-write">
    <span><strong>${t.readWrite}</strong><span>${t.readWriteHint}</span></span></label>`
      : `<p class="hint">${t.readOnlyByPolicy}</p>`
  }
</div>
<p class="hint">${t.manageHint}</p>
<div class="actions">
  <button class="deny" type="submit" name="decision" value="deny">${t.deny}</button>
  <button class="approve" type="submit" name="decision" value="approve">${t.approve}</button>
</div>
</form>
</div></body></html>`;
}

const authorizeQuery = z.object({
  response_type: z.string(),
  client_id: z.string(),
  redirect_uri: z.string().url(),
  code_challenge: z.string(),
  code_challenge_method: z.string().default('S256'),
  state: z.string().optional(),
  scope: z.string().optional(),
  resource: z.string().optional(),
});

export function createOauthRoutes() {
  const app = new Hono<AppContext>();

  // ---- discovery metadata --------------------------------------------------
  app.get('/.well-known/oauth-protected-resource', (c) => {
    const env = c.get('env');
    const issuer = getMcpIssuer(env);
    return c.json({
      resource: getMcpResourceUrl(env),
      authorization_servers: [issuer],
      scopes_supported: [SCOPE_READ, SCOPE_WRITE],
      bearer_methods_supported: ['header'],
      resource_name: 'inventory-hub MCP',
    });
  });

  app.get('/.well-known/oauth-authorization-server', (c) => {
    const env = c.get('env');
    const issuer = getMcpIssuer(env);
    return c.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      scopes_supported: [SCOPE_READ, SCOPE_WRITE],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    });
  });

  // ---- dynamic client registration (RFC 7591) ------------------------------
  app.post(
    '/register',
    rateLimit({ bucket: 'oauth-register', windowMs: 60_000, max: 20 }),
    async (c) => {
      const db = c.get('db');
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          { error: 'invalid_client_metadata', error_description: 'Body must be JSON.' },
          400,
        );
      }
      const parsed = z
        .object({
          redirect_uris: z.array(z.string().url()).min(1),
          client_name: z.string().optional(),
          token_endpoint_auth_method: z
            .enum(['none', 'client_secret_post', 'client_secret_basic'])
            .optional(),
          grant_types: z.array(z.string()).optional(),
        })
        .safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: 'invalid_redirect_uri', error_description: 'redirect_uris is required.' },
          400,
        );
      }
      // Redirect URIs must be HTTPS or localhost (OAuth 2.1 §security).
      for (const uri of parsed.data.redirect_uris) {
        const u = new URL(uri);
        if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
          return c.json(
            {
              error: 'invalid_redirect_uri',
              error_description: 'redirect_uris must be https or localhost.',
            },
            400,
          );
        }
      }
      const { client, clientSecret } = registerClient(db, {
        redirectUris: parsed.data.redirect_uris,
        clientName: parsed.data.client_name,
        tokenEndpointAuthMethod: parsed.data.token_endpoint_auth_method,
        grantTypes: parsed.data.grant_types,
      });
      return c.json(
        {
          client_id: client.id,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          client_name: client.clientName ?? undefined,
          redirect_uris: client.redirectUris,
          token_endpoint_auth_method: client.tokenEndpointAuthMethod,
          grant_types: client.grantTypes,
        },
        201,
      );
    },
  );

  // ---- authorization endpoint ---------------------------------------------
  app.get(
    '/authorize',
    rateLimit({ bucket: 'oauth-authorize', windowMs: 60_000, max: 60 }),
    (c) => {
      const env = c.get('env');
      const db = c.get('db');
      const locale = requestLocale(c, env.EMAIL_LOCALE);
      const t = CONSENT_COPY[locale];
      const fail = (status: 400, message: string) =>
        c.html(renderErrorPage(status, message, { homeUrl: env.PUBLIC_APP_URL, locale }), status);

      const parsed = authorizeQuery.safeParse(c.req.query());
      if (!parsed.success) return fail(400, t.badRequest);
      const q = parsed.data;

      // Validate client + redirect_uri BEFORE trusting the redirect target.
      const client = getClient(db, q.client_id);
      if (!client) return fail(400, t.unknownClient);
      if (!client.redirectUris.includes(q.redirect_uri)) {
        return fail(400, t.redirectMismatch);
      }
      if (q.response_type !== 'code') {
        return c.redirect(
          errorRedirect(
            q.redirect_uri,
            'unsupported_response_type',
            'Only code is supported.',
            q.state,
          ),
        );
      }
      if (q.code_challenge_method !== 'S256' || !q.code_challenge) {
        return c.redirect(
          errorRedirect(q.redirect_uri, 'invalid_request', 'PKCE S256 is required.', q.state),
        );
      }

      // Authenticate the human via the existing session cookie; bounce through
      // Google login if absent.
      const session = loadSession(db, getCookie(c, SESSION_COOKIE));
      if (!session) {
        const pending = `/authorize?${new URLSearchParams(c.req.query()).toString()}`;
        setCookie(c, MCP_PENDING_AUTHORIZE_COOKIE, pending, {
          httpOnly: true,
          sameSite: 'Lax',
          secure: isSecure(env),
          path: '/',
          maxAge: 600,
        });
        return c.redirect('/auth/google/start');
      }

      const policy = getMcpPolicy(db);
      if (!policy.enabled) return fail(400, t.disabled);
      return c.html(
        renderConsent({
          allowWrite: roleMayWrite(policy, session.user.role),
          locale,
          clientName: client.clientName || t.unknownApp,
          userEmail: session.user.email,
          hidden: {
            client_id: q.client_id,
            redirect_uri: q.redirect_uri,
            code_challenge: q.code_challenge,
            code_challenge_method: q.code_challenge_method,
            state: q.state ?? '',
            resource: q.resource ?? '',
          },
        }),
      );
    },
  );

  // ---- consent form submit -------------------------------------------------
  app.post('/authorize/consent', async (c) => {
    const env = c.get('env');
    const db = c.get('db');
    const locale = requestLocale(c, env.EMAIL_LOCALE);
    const t = CONSENT_COPY[locale];
    const fail = (status: 400, message: string) =>
      c.html(renderErrorPage(status, message, { homeUrl: env.PUBLIC_APP_URL, locale }), status);

    const form = await c.req.formData();
    const get = (k: string) => (form.get(k) as string | null) ?? undefined;
    const clientId = get('client_id');
    const redirectUri = get('redirect_uri');
    const codeChallenge = get('code_challenge');
    const state = get('state') || undefined;
    const resource = get('resource') || undefined;
    // Anything but an explicit read-write choice falls back to least privilege.
    let grant: 'read' | 'read-write' = get('grant') === 'read-write' ? 'read-write' : 'read';
    const decision = get('decision');

    if (!clientId || !redirectUri || !codeChallenge) return fail(400, t.incomplete);
    const client = getClient(db, clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return fail(400, t.badClient);
    }
    const session = loadSession(db, getCookie(c, SESSION_COOKIE));
    if (!session) return fail(400, t.sessionExpired);
    const policy = getMcpPolicy(db);
    if (!policy.enabled) return fail(400, t.disabled);
    // The form only offers read-only then, but never trust the form.
    if (!roleMayWrite(policy, session.user.role)) grant = 'read';

    if (decision !== 'approve') {
      return c.redirect(
        errorRedirect(redirectUri, 'access_denied', 'User denied the request.', state),
      );
    }

    const code = createAuthorizationCode(db, {
      clientId,
      userId: session.user.id,
      redirectUri,
      codeChallenge,
      resource: resource ?? null,
      scope: scopeStringFor(grant),
    });
    const u = new URL(redirectUri);
    u.searchParams.set('code', code);
    if (state) u.searchParams.set('state', state);
    return c.redirect(u.toString());
  });

  // ---- token endpoint ------------------------------------------------------
  app.post('/token', rateLimit({ bucket: 'oauth-token', windowMs: 60_000, max: 60 }), async (c) => {
    const env = c.get('env');
    const db = c.get('db');
    const form = await c.req.formData();
    const get = (k: string) => (form.get(k) as string | null) ?? undefined;
    const grantType = get('grant_type');
    const clientId = get('client_id');

    if (!clientId) return c.json({ error: 'invalid_client' }, 401);
    const client = getClient(db, clientId);
    if (!client || !verifyClientSecret(client, get('client_secret'))) {
      return c.json({ error: 'invalid_client' }, 401);
    }

    if (grantType === 'authorization_code') {
      const code = get('code');
      const verifier = get('code_verifier');
      const redirectUri = get('redirect_uri');
      if (!code || !verifier) {
        return c.json(
          { error: 'invalid_request', error_description: 'Missing code/verifier.' },
          400,
        );
      }
      const record = consumeAuthorizationCode(db, code);
      if (!record || record.clientId !== clientId) {
        return c.json({ error: 'invalid_grant', error_description: 'Bad or expired code.' }, 400);
      }
      if (redirectUri && redirectUri !== record.redirectUri) {
        return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch.' }, 400);
      }
      if (!verifyPkce(verifier, record.codeChallenge, record.codeChallengeMethod)) {
        return c.json(
          { error: 'invalid_grant', error_description: 'PKCE verification failed.' },
          400,
        );
      }
      const tokens = issueTokens(db, {
        clientId,
        userId: record.userId,
        scope: record.scope,
        audience: record.resource ?? getMcpResourceUrl(env),
        accessTtlSeconds: env.MCP_ACCESS_TOKEN_TTL,
        refreshTtlSeconds: env.MCP_REFRESH_TOKEN_TTL,
      });
      const agentName = client.clientName ?? clientId;
      const readWrite = scopeAllowsWrite(record.scope);
      recordMcpEvent(db, {
        userId: record.userId,
        actorUserId: record.userId,
        type: 'connected',
        kind: 'oauth',
        connectionName: agentName,
        access: readWrite ? 'read-write' : 'read',
      });
      await notifyAgentConnected(db, c.get('emailSender'), {
        userId: record.userId,
        agentName,
        kind: 'oauth',
        readWrite,
        publicAppUrl: env.PUBLIC_APP_URL,
        locale: env.EMAIL_LOCALE,
      });
      return c.json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: tokens.scope,
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = get('refresh_token');
      if (!refreshToken) return c.json({ error: 'invalid_request' }, 400);
      let reused: ReusedRefreshToken | null = null;
      const rotated = rotateRefreshToken(db, refreshToken, {
        accessTtlSeconds: env.MCP_ACCESS_TOKEN_TTL,
        refreshTtlSeconds: env.MCP_REFRESH_TOKEN_TTL,
        clientId,
        onReuse: (info) => {
          reused = info;
        },
      });
      if (reused) {
        const { userId } = reused as ReusedRefreshToken;
        const agentName = client.clientName ?? clientId;
        recordMcpEvent(db, {
          userId,
          actorUserId: null,
          type: 'reuse_revoked',
          kind: 'oauth',
          connectionName: agentName,
          access: null,
        });
        await notifyAgentRevokedForReuse(db, c.get('emailSender'), {
          userId,
          agentName,
          publicAppUrl: env.PUBLIC_APP_URL,
          locale: env.EMAIL_LOCALE,
        });
      }
      if (!rotated || rotated.clientId !== clientId) {
        return c.json(
          { error: 'invalid_grant', error_description: 'Bad or expired refresh token.' },
          400,
        );
      }
      return c.json({
        access_token: rotated.accessToken,
        token_type: 'Bearer',
        expires_in: rotated.expiresIn,
        refresh_token: rotated.refreshToken,
        scope: rotated.scope,
      });
    }

    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  return app;
}
