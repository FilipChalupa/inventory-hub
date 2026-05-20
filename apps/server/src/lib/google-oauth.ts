/**
 * Minimal Google OAuth 2.0 (PKCE) helper — no external library.
 * Returns the authorization URL + verifier, exchanges code → ID token,
 * and parses the user info from the ID token payload.
 */
import { createHash, randomBytes } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
};

export type GoogleUser = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
};

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return base64url(randomBytes(24));
}

export function buildAuthorizationUrl(config: GoogleConfig, state: string, challenge: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid ID token');
  const payload = Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(payload) as Record<string, unknown>;
}

export async function exchangeCode(
  config: GoogleConfig,
  code: string,
  verifier: string,
): Promise<GoogleUser> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUrl,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error('Google response missing id_token');
  const claims = decodeIdTokenPayload(json.id_token);

  const sub = claims.sub as string | undefined;
  const email = claims.email as string | undefined;
  const name = (claims.name as string | undefined) ?? (email ?? '');
  const picture = claims.picture as string | undefined;
  const emailVerified = claims.email_verified === true;

  if (!sub || !email) throw new Error('Google response missing sub/email');
  return { sub, email, emailVerified, name, picture };
}
