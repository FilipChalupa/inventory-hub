import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
};

/**
 * Singleton — exactly one row with id = 'singleton'.
 */
export const orgSettings = sqliteTable('org_settings', {
  id: text('id').primaryKey().default('singleton'),
  name: text('name').notNull(),
  codePrefix: text('code_prefix'),
  allowedDomains: text('allowed_domains', { mode: 'json' })
    .$type<{ domain: string; defaultRole: 'admin' | 'operator' | 'member' | 'auditor' }[]>()
    .notNull()
    .default([]),
  ...timestamps,
});

export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ['admin', 'operator', 'member', 'auditor'] })
      .notNull()
      .default('member'),
    googleSubject: text('google_subject'),
    imageUrl: text('image_url'),
    disabledAt: integer('disabled_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => ({
    emailUnique: uniqueIndex('users_email_unique').on(t.email),
    googleSubjectUnique: uniqueIndex('users_google_subject_unique').on(t.googleSubject),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ...timestamps,
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

/**
 * API keys for programmatic / integration access to the REST API. The raw
 * token is shown once at creation; only its sha256 hash is stored. A key
 * authenticates as `userId` (the admin who created it) with that user's role.
 */
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: id(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => ({
    tokenHashUnique: uniqueIndex('api_keys_token_hash_unique').on(t.tokenHash),
    userIdx: index('api_keys_user_idx').on(t.userId),
  }),
);

export const invitations = sqliteTable(
  'invitations',
  {
    id: id(),
    email: text('email').notNull(),
    role: text('role', { enum: ['admin', 'operator', 'member', 'auditor'] }).notNull(),
    token: text('token').notNull(),
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => users.id),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ...timestamps,
  },
  (t) => ({
    tokenUnique: uniqueIndex('invitations_token_unique').on(t.token),
  }),
);

export const locations = sqliteTable(
  'locations',
  {
    id: id(),
    name: text('name').notNull(),
    parentId: text('parent_id'),
    ...timestamps,
  },
  (t) => ({
    parentIdx: index('locations_parent_idx').on(t.parentId),
  }),
);

export const assetTypes = sqliteTable(
  'asset_types',
  {
    id: id(),
    name: text('name').notNull(),
    codePrefix: text('code_prefix').notNull(),
    customFieldsSchema: text('custom_fields_schema', { mode: 'json' })
      .$type<
        Array<{
          key: string;
          label: string;
          type: 'text' | 'number' | 'date' | 'boolean' | 'select';
          required?: boolean;
          options?: string[];
        }>
      >()
      .notNull()
      .default([]),
    ...timestamps,
  },
  (t) => ({
    codePrefixUnique: uniqueIndex('asset_types_code_prefix_unique').on(t.codePrefix),
  }),
);

export const assets = sqliteTable(
  'assets',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    typeId: text('type_id').references(() => assetTypes.id, { onDelete: 'set null' }),
    locationId: text('location_id').references(() => locations.id, { onDelete: 'set null' }),
    assignedToUserId: text('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: text('status', {
      enum: ['in_stock', 'assigned', 'on_loan', 'in_repair', 'damaged', 'sold', 'lost', 'retired'],
    })
      .notNull()
      .default('in_stock'),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    customFields: text('custom_fields', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    photoPaths: text('photo_paths', { mode: 'json' }).$type<string[]>().notNull().default([]),
    documentPaths: text('document_paths', { mode: 'json' }).$type<string[]>().notNull().default([]),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    codeUnique: uniqueIndex('assets_code_unique').on(t.code),
    statusIdx: index('assets_status_idx').on(t.status),
    typeIdx: index('assets_type_idx').on(t.typeId),
    locationIdx: index('assets_location_idx').on(t.locationId),
  }),
);

/**
 * External identifiers (serial number, EAN, manufacturer SKU, etc.) attached
 * to an asset. One asset can have many; each (kind, value) pair is unique
 * across the org so we can scan a serial number and resolve the asset.
 */
export const assetExternalIds = sqliteTable(
  'asset_external_ids',
  {
    id: id(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    ...timestamps,
  },
  (t) => ({
    assetIdx: index('asset_external_ids_asset_idx').on(t.assetId),
    valueIdx: index('asset_external_ids_value_idx').on(t.value),
    kindValueUnique: uniqueIndex('asset_external_ids_kind_value_unique').on(t.kind, t.value),
  }),
);

export const assetEvents = sqliteTable(
  'asset_events',
  {
    id: id(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    assetIdx: index('asset_events_asset_idx').on(t.assetId),
    occurredIdx: index('asset_events_occurred_idx').on(t.occurredAt),
  }),
);

export const damageReports = sqliteTable(
  'damage_reports',
  {
    id: id(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    reportedAt: integer('reported_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    reportedByUserId: text('reported_by_user_id')
      .notNull()
      .references(() => users.id),
    description: text('description').notNull(),
    severity: text('severity', { enum: ['minor', 'major', 'total'] }).notNull(),
    photoPaths: text('photo_paths', { mode: 'json' }).$type<string[]>().notNull().default([]),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    assetIdx: index('damage_reports_asset_idx').on(t.assetId),
  }),
);

/**
 * Standalone external borrowers (contractors, partners, customers…) that
 * may be referenced by multiple loans. Internal employees use `users`
 * directly via `loans.borrowerUserId`; this table is for everyone else.
 */
export const contacts = sqliteTable(
  'contacts',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    organization: text('organization'),
    note: text('note'),
    ...timestamps,
  },
  (t) => ({
    nameIdx: index('contacts_name_idx').on(t.name),
  }),
);

export const loans = sqliteTable(
  'loans',
  {
    id: id(),
    borrowerName: text('borrower_name').notNull(),
    borrowerUserId: text('borrower_user_id').references(() => users.id, { onDelete: 'set null' }),
    borrowerContactId: text('borrower_contact_id').references(() => contacts.id, {
      onDelete: 'set null',
    }),
    borrowerContact: text('borrower_contact'),
    purpose: text('purpose'),
    loanedAt: integer('loaned_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    // When null the loan is still planned (assets reserved but in stock);
    // set to the activation moment once the loan actually starts.
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    expectedReturnAt: integer('expected_return_at', { mode: 'timestamp_ms' }),
    overdueNotifiedAt: integer('overdue_notified_at', { mode: 'timestamp_ms' }),
    // Set once the "your reservation starts soon" reminder has been sent,
    // so the reminder runner stays idempotent.
    startReminderSentAt: integer('start_reminder_sent_at', { mode: 'timestamp_ms' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    expectedReturnIdx: index('loans_expected_return_idx').on(t.expectedReturnAt),
    contactIdx: index('loans_contact_idx').on(t.borrowerContactId),
  }),
);

export const loanItems = sqliteTable(
  'loan_items',
  {
    id: id(),
    loanId: text('loan_id')
      .notNull()
      .references(() => loans.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    returnedAt: integer('returned_at', { mode: 'timestamp_ms' }),
    returnCondition: text('return_condition', { enum: ['ok', 'damaged'] }),
    returnNotes: text('return_notes'),
  },
  (t) => ({
    loanIdx: index('loan_items_loan_idx').on(t.loanId),
    assetIdx: index('loan_items_asset_idx').on(t.assetId),
  }),
);

/**
 * MCP / OAuth 2.1 — registered OAuth clients (RFC 7591 dynamic client
 * registration). One row per MCP client that registered against our
 * authorization server.
 */
export const oauthClients = sqliteTable('oauth_clients', {
  // client_id we issue (public identifier).
  id: text('id').primaryKey(),
  // Hashed client secret for confidential clients; null for public clients.
  secretHash: text('secret_hash'),
  clientName: text('client_name'),
  // Exact-match redirect URIs registered by the client (RFC 7591).
  redirectUris: text('redirect_uris', { mode: 'json' }).$type<string[]>().notNull(),
  // 'none' (public + PKCE) or 'client_secret_post'/'client_secret_basic'.
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
  grantTypes: text('grant_types', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(['authorization_code', 'refresh_token']),
  ...timestamps,
});

/**
 * MCP / OAuth 2.1 — short-lived authorization codes bound to a client, a
 * user, a PKCE challenge, the requested resource and the granted scope.
 */
export const oauthAuthCodes = sqliteTable(
  'oauth_auth_codes',
  {
    // Hash of the authorization code (the plaintext is only sent to the client).
    codeHash: text('code_hash').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
    // RFC 8707 resource indicator the token will be audience-bound to.
    resource: text('resource'),
    // Granted MCP scope: 'mcp:read' or 'mcp:read mcp:write'.
    scope: text('scope').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    userIdx: index('oauth_auth_codes_user_idx').on(t.userId),
  }),
);

/**
 * MCP / OAuth 2.1 — issued access + refresh tokens. Tokens are stored
 * hashed; the audience pins them to our MCP resource (RFC 8707).
 */
export const oauthTokens = sqliteTable(
  'oauth_tokens',
  {
    id: id(),
    accessTokenHash: text('access_token_hash').notNull(),
    refreshTokenHash: text('refresh_token_hash'),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    audience: text('audience'),
    accessExpiresAt: integer('access_expires_at', { mode: 'timestamp_ms' }).notNull(),
    refreshExpiresAt: integer('refresh_expires_at', { mode: 'timestamp_ms' }),
    // Set when this token was created by rotating a refresh token, so the
    // previous refresh token can be considered consumed.
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (t) => ({
    accessIdx: uniqueIndex('oauth_tokens_access_idx').on(t.accessTokenHash),
    refreshIdx: index('oauth_tokens_refresh_idx').on(t.refreshTokenHash),
    userIdx: index('oauth_tokens_user_idx').on(t.userId),
  }),
);

export type OrgSettingsRow = typeof orgSettings.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type LoanRow = typeof loans.$inferSelect;
export type LoanItemRow = typeof loanItems.$inferSelect;
export type DamageReportRow = typeof damageReports.$inferSelect;
export type OauthClientRow = typeof oauthClients.$inferSelect;
export type OauthAuthCodeRow = typeof oauthAuthCodes.$inferSelect;
export type OauthTokenRow = typeof oauthTokens.$inferSelect;
