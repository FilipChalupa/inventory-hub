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
  allowedDomains: text('allowed_domains', { mode: 'json' }).$type<
    { domain: string; defaultRole: 'admin' | 'operator' | 'member' | 'auditor' }[]
  >().notNull().default([]),
  ...timestamps,
});

export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ['admin', 'operator', 'member', 'auditor'] }).notNull().default('member'),
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
    assignedToUserId: text('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
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

export const assetEvents = sqliteTable(
  'asset_events',
  {
    id: id(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
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

export const loans = sqliteTable(
  'loans',
  {
    id: id(),
    borrowerName: text('borrower_name').notNull(),
    borrowerUserId: text('borrower_user_id').references(() => users.id, { onDelete: 'set null' }),
    borrowerContact: text('borrower_contact'),
    purpose: text('purpose'),
    loanedAt: integer('loaned_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    expectedReturnAt: integer('expected_return_at', { mode: 'timestamp_ms' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    expectedReturnIdx: index('loans_expected_return_idx').on(t.expectedReturnAt),
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

export type OrgSettingsRow = typeof orgSettings.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type LoanRow = typeof loans.$inferSelect;
export type LoanItemRow = typeof loanItems.$inferSelect;
export type DamageReportRow = typeof damageReports.$inferSelect;
