import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import { invitations, users } from '../db/schema.js';
import { findOrCreateUserForGoogle } from '../lib/auth-onboard.js';
import { renderErrorPage } from '../lib/error-page.js';
import {
  buildAuthorizationUrl,
  exchangeCode,
  generatePkcePair,
  generateState,
  type GoogleConfig,
} from '../lib/google-oauth.js';
import { rateLimit } from '../lib/rate-limit.js';
import { SESSION_COOKIE, createSession, deleteSession } from '../lib/sessions.js';

const OAUTH_STATE_COOKIE = 'inv_oauth_state';
const OAUTH_VERIFIER_COOKIE = 'inv_oauth_verifier';

function googleConfig(env: AppContext['Variables']['env']): GoogleConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URL) {
    return null;
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUrl: env.GOOGLE_REDIRECT_URL,
  };
}

function isSecure(env: AppContext['Variables']['env']): boolean {
  return env.NODE_ENV === 'production';
}

function sessionCookieOptions(env: AppContext['Variables']['env'], expiresAt?: Date) {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure(env),
    path: '/',
    expires: expiresAt,
  } as const;
}

export const authRoutes = new Hono<AppContext>()
  .get('/me', (c) => {
    const user = c.get('user');
    if (!user) return c.json({ authenticated: false }, 200);
    return c.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        imageUrl: user.imageUrl,
      },
    });
  })

  .post('/logout', (c) => {
    const env = c.get('env');
    const db = c.get('db');
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isSecure(env) });
    return c.json({ ok: true });
  })

  // ---- Google OAuth -------------------------------------------------------

  .get('/google/start', (c) => {
    const env = c.get('env');
    const cfg = googleConfig(env);
    if (!cfg) return c.json({ error: { message: 'Google OAuth není nakonfigurováno' } }, 503);

    const { verifier, challenge } = generatePkcePair();
    const state = generateState();
    setCookie(c, OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isSecure(env),
      path: '/',
      maxAge: 600,
    });
    setCookie(c, OAUTH_VERIFIER_COOKIE, verifier, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isSecure(env),
      path: '/',
      maxAge: 600,
    });
    return c.redirect(buildAuthorizationUrl(cfg, state, challenge));
  })

  .get(
    '/google/callback',
    rateLimit({ bucket: 'oauth-callback', windowMs: 60_000, max: 30 }),
    async (c) => {
      const env = c.get('env');
      const db = c.get('db');
      const cfg = googleConfig(env);
      const fail = (status: 400 | 403 | 503, message: string) =>
        c.html(renderErrorPage(status, message, { homeUrl: env.PUBLIC_APP_URL }), status);
      if (!cfg) return fail(503, 'Přihlášení přes Google není nakonfigurováno.');

      // Google redirects here with ?error=... when the user cancels or denies.
      const oauthError = c.req.query('error');
      if (oauthError) {
        return fail(
          400,
          oauthError === 'access_denied'
            ? 'Přihlášení přes Google bylo zrušeno.'
            : 'Přihlášení přes Google se nezdařilo.',
        );
      }

      const code = c.req.query('code');
      const state = c.req.query('state');
      if (!code || !state) {
        return fail(400, 'Chybí přihlašovací údaje z Googlu. Zkus to prosím znovu.');
      }
      const expectedState = getCookie(c, OAUTH_STATE_COOKIE);
      const verifier = getCookie(c, OAUTH_VERIFIER_COOKIE);
      if (!expectedState || !verifier || state !== expectedState) {
        return fail(400, 'Neplatný nebo vypršelý přihlašovací požadavek. Zkus to prosím znovu.');
      }
      deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/', secure: isSecure(env) });
      deleteCookie(c, OAUTH_VERIFIER_COOKIE, { path: '/', secure: isSecure(env) });

      let identity;
      try {
        identity = await exchangeCode(cfg, code, verifier);
      } catch (err) {
        console.error('Google exchange failed:', err);
        return fail(400, 'Přihlášení přes Google selhalo. Zkus to prosím znovu.');
      }

      const user = findOrCreateUserForGoogle(db, identity);
      if (!user) {
        return fail(403, 'Tvůj e-mail nemá oprávnění se přihlásit. Kontaktuj administrátora.');
      }

      const { token, expiresAt } = createSession(db, user.id);
      setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(env, expiresAt));

      // If the login was triggered by an MCP /authorize request, return there
      // instead of the app home. Cookie name kept in sync with mcp/oauth-routes
      // (MCP_PENDING_AUTHORIZE_COOKIE). Only same-origin /authorize paths are
      // honoured to prevent open redirects.
      const pendingAuthorize = getCookie(c, 'mcp_pending_authorize');
      if (pendingAuthorize) {
        deleteCookie(c, 'mcp_pending_authorize', { path: '/', secure: isSecure(env) });
        if (pendingAuthorize.startsWith('/authorize?')) {
          return c.redirect(pendingAuthorize);
        }
      }

      return c.redirect(env.PUBLIC_APP_URL + '/');
    },
  )

  // ---- Invitation acceptance (public) -------------------------------------

  // Rate-limited: invite tokens are bearer credentials in a URL, so throttle
  // lookups/acceptance to stop token brute-forcing and email/role enumeration.
  .get('/invite/:token', rateLimit({ bucket: 'invite-lookup', windowMs: 60_000, max: 30 }), (c) => {
    const db = c.get('db');
    const token = c.req.param('token');
    const invite = db.select().from(invitations).where(eq(invitations.token, token)).get();
    if (!invite) return c.json({ error: { message: 'Pozvánka nenalezena' } }, 404);
    if (invite.acceptedAt) {
      return c.json({ error: { message: 'Pozvánka už byla použita' } }, 409);
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      return c.json({ error: { message: 'Pozvánka vypršela' } }, 410);
    }
    return c.json({ email: invite.email, role: invite.role });
  })

  .post(
    '/accept-invite',
    rateLimit({ bucket: 'accept-invite', windowMs: 60_000, max: 10 }),
    zValidator(
      'json',
      z.object({
        token: z.string().min(1),
        name: z.string().min(1).max(200),
      }),
    ),
    (c) => {
      const db = c.get('db');
      const env = c.get('env');
      const { token, name } = c.req.valid('json');

      const invite = db.select().from(invitations).where(eq(invitations.token, token)).get();
      if (!invite) return c.json({ error: { message: 'Pozvánka nenalezena' } }, 404);
      if (invite.acceptedAt) {
        return c.json({ error: { message: 'Pozvánka už byla použita' } }, 409);
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        return c.json({ error: { message: 'Pozvánka vypršela' } }, 410);
      }

      const existing = db.select().from(users).where(eq(users.email, invite.email)).get();
      const userId = existing
        ? existing.id
        : (() => {
            const id = crypto.randomUUID();
            db.insert(users).values({ id, email: invite.email, name, role: invite.role }).run();
            return id;
          })();

      db.update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, invite.id))
        .run();

      const { token: sessionToken, expiresAt } = createSession(db, userId);
      setCookie(c, SESSION_COOKIE, sessionToken, sessionCookieOptions(env, expiresAt));
      return c.json({ ok: true });
    },
  )

  // ---- Dev-only login (without real Google credentials) -------------------

  .post(
    '/dev-login',
    // dev-login is gated by NODE_ENV=production above, so the rate limit
    // is purely a guard for noisy dev/test usage. Generous because each
    // E2E spec's beforeEach calls it.
    rateLimit({ bucket: 'dev-login', windowMs: 60_000, max: 100 }),
    zValidator(
      'json',
      z.object({
        email: z.string().email(),
      }),
    ),
    (c) => {
      const env = c.get('env');
      if (env.NODE_ENV === 'production') {
        return c.json({ error: { message: 'Dev-login je dostupný jen v dev/test módu' } }, 403);
      }
      const db = c.get('db');
      const { email } = c.req.valid('json');
      const user = db.select().from(users).where(eq(users.email, email)).get();
      if (!user) {
        return c.json({ error: { message: `Uživatel ${email} neexistuje` } }, 404);
      }
      const { token, expiresAt } = createSession(db, user.id);
      setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(env, expiresAt));
      return c.json({
        ok: true,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
    },
  );
