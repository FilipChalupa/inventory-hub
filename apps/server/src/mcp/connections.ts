/**
 * Management view over MCP access: the OAuth connections a user authorized
 * from an MCP client, plus personal bearer tokens minted in the web app for
 * agents that can't run the OAuth flow. Backs the "AI assistants" page.
 *
 * An OAuth *connection* is the set of token rows for one (client, user) pair —
 * refresh-token rotation creates a new row each time, so the pair, not the
 * row, is what the user recognises and revokes. Revoking deletes the rows, so
 * the bearer stops working on its very next /mcp request.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { oauthClients, oauthTokens, users } from '../db/schema.js';
import { hashToken, randomToken, scopeAllowsWrite, scopeStringFor } from './oauth-store.js';
import type { GrantedScope } from './oauth-store.js';

/** Built-in client every personal token hangs off (the FK requires one). */
export const PERSONAL_CLIENT_ID = 'personal-token';

/** Recognisable prefix so leaked personal MCP tokens are greppable. */
export const PERSONAL_TOKEN_PREFIX = 'ihm_';

// `access_expires_at` is NOT NULL; a non-expiring personal token stores this
// sentinel and is reported as `expiresAt: null`.
const NEVER = new Date('9999-12-31T00:00:00Z');

export type McpConnectionUser = { id: string; name: string; email: string };

export type McpConnection = {
  /** Client id (oauth) or token row id (personal) — the revoke handle. */
  id: string;
  kind: 'oauth' | 'personal';
  name: string;
  access: GrantedScope;
  /** Personal tokens only: the plaintext prefix shown for identification. */
  tokenPrefix: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  /** Null = never expires. For OAuth, when the refresh token runs out. */
  expiresAt: Date | null;
  user: McpConnectionUser;
};

function ensurePersonalClient(db: Db): void {
  db.insert(oauthClients)
    .values({
      id: PERSONAL_CLIENT_ID,
      clientName: 'Personal token',
      // No redirect URIs → /authorize can never issue codes for this client.
      redirectUris: [],
      tokenEndpointAuthMethod: 'none',
      grantTypes: [],
    })
    .onConflictDoNothing()
    .run();
}

export type CreatedPersonalToken = { connection: McpConnection; token: string };

export function createPersonalToken(
  db: Db,
  input: {
    user: McpConnectionUser;
    name: string;
    access: GrantedScope;
    expiresInDays: number | null;
  },
): CreatedPersonalToken {
  ensurePersonalClient(db);
  const token = PERSONAL_TOKEN_PREFIX + randomToken(32);
  const tokenPrefix = token.slice(0, 12);
  const expiresAt =
    input.expiresInDays == null
      ? NEVER
      : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  const id = crypto.randomUUID();
  db.insert(oauthTokens)
    .values({
      id,
      kind: 'personal',
      name: input.name,
      tokenPrefix,
      accessTokenHash: hashToken(token),
      refreshTokenHash: null,
      clientId: PERSONAL_CLIENT_ID,
      userId: input.user.id,
      scope: scopeStringFor(input.access),
      // Not audience-bound: a personal token should survive a change of
      // MCP_BASE_URL (it's only ever accepted by this server anyway).
      audience: null,
      accessExpiresAt: expiresAt,
      refreshExpiresAt: null,
    })
    .run();
  const row = db.select().from(oauthTokens).where(eq(oauthTokens.id, id)).get()!;
  return {
    token,
    connection: {
      id,
      kind: 'personal',
      name: input.name,
      access: input.access,
      tokenPrefix,
      createdAt: row.createdAt,
      lastUsedAt: null,
      expiresAt: input.expiresInDays == null ? null : expiresAt,
      user: input.user,
    },
  };
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Lists live connections — for one user, or (userId omitted) the whole org.
 * Dead OAuth pairs (every row revoked or past its refresh expiry) and expired
 * personal tokens are left out.
 */
export function listConnections(db: Db, opts: { userId?: string } = {}): McpConnection[] {
  const rows = db
    .select({
      token: oauthTokens,
      clientName: oauthClients.clientName,
      userName: users.name,
      userEmail: users.email,
    })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
    .innerJoin(users, eq(users.id, oauthTokens.userId))
    .where(opts.userId ? eq(oauthTokens.userId, opts.userId) : undefined)
    .all();

  const now = Date.now();
  const result: McpConnection[] = [];
  const oauthPairs = new Map<string, McpConnection & { live: boolean; latest: Date }>();

  for (const r of rows) {
    const t = r.token;
    const user = { id: t.userId, name: r.userName, email: r.userEmail };
    if (t.kind === 'personal') {
      if (t.accessExpiresAt.getTime() < now) continue;
      result.push({
        id: t.id,
        kind: 'personal',
        name: t.name ?? '',
        access: scopeAllowsWrite(t.scope) ? 'read-write' : 'read',
        tokenPrefix: t.tokenPrefix,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        expiresAt: t.accessExpiresAt.getTime() >= NEVER.getTime() ? null : t.accessExpiresAt,
        user,
      });
      continue;
    }

    const key = `${t.clientId}\u0000${t.userId}`;
    const live =
      !t.revokedAt &&
      ((t.refreshExpiresAt?.getTime() ?? 0) > now || t.accessExpiresAt.getTime() > now);
    let pair = oauthPairs.get(key);
    if (!pair) {
      pair = {
        id: t.clientId,
        kind: 'oauth',
        name: r.clientName ?? t.clientId,
        access: 'read',
        tokenPrefix: null,
        createdAt: t.createdAt,
        lastUsedAt: null,
        expiresAt: null,
        user,
        live: false,
        latest: new Date(0),
      };
      oauthPairs.set(key, pair);
    }
    if (t.createdAt < pair.createdAt) pair.createdAt = t.createdAt;
    pair.lastUsedAt = maxDate(pair.lastUsedAt, t.lastUsedAt);
    // Scope + expiry come from the newest live row (the one the client holds).
    if (live && t.createdAt >= pair.latest) {
      pair.latest = t.createdAt;
      pair.access = scopeAllowsWrite(t.scope) ? 'read-write' : 'read';
      pair.expiresAt = t.refreshExpiresAt ?? t.accessExpiresAt;
    }
    pair.live ||= live;
  }

  for (const { live, latest: _latest, ...conn } of oauthPairs.values()) {
    if (live) result.push(conn);
  }
  return result.sort(
    (a, b) => (b.lastUsedAt ?? b.createdAt).getTime() - (a.lastUsedAt ?? a.createdAt).getTime(),
  );
}

/** Disconnects an OAuth client for one user. Returns false if nothing matched. */
export function revokeOauthConnection(db: Db, clientId: string, userId: string): boolean {
  const res = db
    .delete(oauthTokens)
    .where(
      and(
        eq(oauthTokens.clientId, clientId),
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.kind, 'oauth'),
      ),
    )
    .run();
  return res.changes > 0;
}

/** Looks up a personal token's owner (for authorization before revoking). */
export function getPersonalTokenOwner(db: Db, id: string): string | null {
  const row = db
    .select({ userId: oauthTokens.userId })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.id, id), eq(oauthTokens.kind, 'personal')))
    .get();
  return row?.userId ?? null;
}

export function revokePersonalToken(db: Db, id: string): void {
  db.delete(oauthTokens)
    .where(and(eq(oauthTokens.id, id), eq(oauthTokens.kind, 'personal')))
    .run();
}
