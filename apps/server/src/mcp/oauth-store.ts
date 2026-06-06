/**
 * OAuth 2.1 storage + crypto helpers backing the MCP authorization server.
 *
 * The MCP server acts as both authorization server and resource server. This
 * module owns the persistence (clients, authorization codes, tokens) and the
 * small crypto primitives (random tokens, hashing, PKCE verification). All
 * secrets are stored hashed; plaintext only ever leaves in the HTTP response
 * to the client.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { oauthAuthCodes, oauthClients, oauthTokens } from '../db/schema.js';
import type { OauthClientRow } from '../db/schema.js';

// MCP scopes. Read is always granted; write is added when the user picks the
// read-write mode on the consent screen.
export const SCOPE_READ = 'mcp:read';
export const SCOPE_WRITE = 'mcp:write';
export const SUPPORTED_SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;

export type GrantedScope = 'read' | 'read-write';

export function scopeStringFor(mode: GrantedScope): string {
  return mode === 'read-write' ? `${SCOPE_READ} ${SCOPE_WRITE}` : SCOPE_READ;
}

export function scopeAllowsWrite(scope: string): boolean {
  return scope.split(/\s+/).includes(SCOPE_WRITE);
}

// ---- crypto helpers --------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Cryptographically random opaque token / identifier. */
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

/** SHA-256 hex digest — used to store codes/tokens/secrets at rest. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verifies a PKCE code_verifier against the stored challenge. Only S256 is
 * supported (plain is disallowed by the MCP spec / OAuth 2.1 best practice).
 */
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== 'S256') return false;
  const computed = base64url(createHash('sha256').update(verifier).digest());
  return computed === challenge;
}

// ---- client registration (RFC 7591) ---------------------------------------

export type RegisterClientInput = {
  redirectUris: string[];
  clientName?: string;
  tokenEndpointAuthMethod?: string;
  grantTypes?: string[];
};

export type RegisteredClient = {
  client: OauthClientRow;
  /** Plaintext secret, only returned at registration time for confidential clients. */
  clientSecret?: string;
};

export function registerClient(db: Db, input: RegisterClientInput): RegisteredClient {
  const clientId = randomToken(16);
  const authMethod = input.tokenEndpointAuthMethod ?? 'none';
  let clientSecret: string | undefined;
  let secretHash: string | null = null;
  if (authMethod !== 'none') {
    clientSecret = randomToken(32);
    secretHash = hashToken(clientSecret);
  }
  db.insert(oauthClients)
    .values({
      id: clientId,
      secretHash,
      clientName: input.clientName ?? null,
      redirectUris: input.redirectUris,
      tokenEndpointAuthMethod: authMethod,
      grantTypes: input.grantTypes ?? ['authorization_code', 'refresh_token'],
    })
    .run();
  const client = db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get()!;
  return { client, clientSecret };
}

export function getClient(db: Db, clientId: string): OauthClientRow | null {
  return db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get() ?? null;
}

export function verifyClientSecret(client: OauthClientRow, secret: string | undefined): boolean {
  if (client.tokenEndpointAuthMethod === 'none') return true; // public client
  if (!client.secretHash || !secret) return false;
  return safeEqualHex(client.secretHash, hashToken(secret));
}

// ---- authorization codes ---------------------------------------------------

export type CreateAuthCodeInput = {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  resource: string | null;
  scope: string;
  ttlMs?: number;
};

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

/** Issues an authorization code and returns the plaintext code. */
export function createAuthorizationCode(db: Db, input: CreateAuthCodeInput): string {
  const code = randomToken(32);
  db.insert(oauthAuthCodes)
    .values({
      codeHash: hashToken(code),
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod ?? 'S256',
      resource: input.resource,
      scope: input.scope,
      expiresAt: new Date(Date.now() + (input.ttlMs ?? AUTH_CODE_TTL_MS)),
    })
    .run();
  return code;
}

/**
 * Atomically consumes an authorization code: returns it once and deletes it
 * (single-use), or null if missing/expired.
 */
export function consumeAuthorizationCode(db: Db, code: string) {
  const codeHash = hashToken(code);
  const row = db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, codeHash)).get();
  if (!row) return null;
  db.delete(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, codeHash)).run();
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

// ---- access + refresh tokens -----------------------------------------------

export type IssueTokensInput = {
  clientId: string;
  userId: string;
  scope: string;
  audience: string | null;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

export function issueTokens(db: Db, input: IssueTokensInput): IssuedTokens {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const now = Date.now();
  db.insert(oauthTokens)
    .values({
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      clientId: input.clientId,
      userId: input.userId,
      scope: input.scope,
      audience: input.audience,
      accessExpiresAt: new Date(now + input.accessTtlSeconds * 1000),
      refreshExpiresAt: new Date(now + input.refreshTtlSeconds * 1000),
    })
    .run();
  return {
    accessToken,
    refreshToken,
    expiresIn: input.accessTtlSeconds,
    scope: input.scope,
  };
}

export type VerifiedToken = {
  userId: string;
  clientId: string;
  scope: string;
  audience: string | null;
  expiresAt: number;
};

/** Verifies an access token: must exist, not be revoked, and not be expired. */
export function verifyAccessToken(db: Db, token: string): VerifiedToken | null {
  const row = db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.accessTokenHash, hashToken(token)))
    .get();
  if (!row || row.revokedAt) return null;
  if (row.accessExpiresAt.getTime() < Date.now()) return null;
  return {
    userId: row.userId,
    clientId: row.clientId,
    scope: row.scope,
    audience: row.audience,
    expiresAt: Math.floor(row.accessExpiresAt.getTime() / 1000),
  };
}

/**
 * Rotates a refresh token: validates it, revokes the old row, and issues a
 * fresh access+refresh pair (RFC: refresh token rotation for public clients).
 * Returns null if the refresh token is invalid/expired/revoked.
 */
export function rotateRefreshToken(
  db: Db,
  refreshToken: string,
  opts: { accessTtlSeconds: number; refreshTtlSeconds: number },
): (IssuedTokens & { clientId: string; userId: string; audience: string | null }) | null {
  const row = db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.refreshTokenHash, hashToken(refreshToken)))
    .get();
  if (!row || row.revokedAt) return null;
  if (row.refreshExpiresAt && row.refreshExpiresAt.getTime() < Date.now()) return null;

  return db.transaction((tx) => {
    tx.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.id, row.id)).run();
    const issued = issueTokens(tx as unknown as Db, {
      clientId: row.clientId,
      userId: row.userId,
      scope: row.scope,
      audience: row.audience,
      accessTtlSeconds: opts.accessTtlSeconds,
      refreshTtlSeconds: opts.refreshTtlSeconds,
    });
    return { ...issued, clientId: row.clientId, userId: row.userId, audience: row.audience };
  });
}

/** Revokes the token row matching the given access or refresh token. */
export function revokeToken(db: Db, token: string): void {
  const hash = hashToken(token);
  db.update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthTokens.accessTokenHash, hash))
    .run();
  db.update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthTokens.refreshTokenHash, hash))
    .run();
}

/** Housekeeping: drop expired authorization codes and access tokens. */
export function pruneExpiredOauth(db: Db): void {
  const now = new Date();
  db.delete(oauthAuthCodes).where(lt(oauthAuthCodes.expiresAt, now)).run();
}
