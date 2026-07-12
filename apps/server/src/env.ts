import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().default('file:./data/app.db'),
  // The app has no way to know whether backups are actually running — it only
  // knows what you tell it via env. Set this to `1`/`true` once you've wired up
  // Litestream (or another backup mechanism); it silences the admin "backups
  // not configured" warning in Settings. See docs/SELF_HOSTING.md.
  BACKUPS_CONFIGURED: z
    .string()
    .optional()
    .transform((v) => v === '1' || v?.toLowerCase() === 'true'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URL: z.string().url().optional(),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5_242_880),
  // ISO 4217 currency code used to format asset purchase prices and the
  // dashboard's inventory value. The app is single-org, so one currency.
  CURRENCY: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .transform((v) => v.toUpperCase())
    .default('CZK'),
  // Language for outbound emails (invitations, reminders, digests). Org-wide —
  // external recipients (borrowers, invitees) have no per-user preference.
  EMAIL_LOCALE: z.enum(['cs', 'en']).default('cs'),
  // GDPR retention: when set, audit-log (asset event) history older than this
  // many days is periodically deleted. Unset = keep indefinitely.
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Canonical RFC 8707 resource identifier for the MCP server (the URL MCP
  // clients connect to, including the /mcp path). Tokens are audience-bound
  // to this value. Defaults to PUBLIC_APP_URL + '/mcp' when unset.
  MCP_BASE_URL: z.string().url().optional(),
  // Access/refresh token lifetimes (seconds). Access tokens are short-lived;
  // refresh tokens are rotated on use.
  MCP_ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(3600),
  MCP_REFRESH_TOKEN_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  return result.data;
}

export function getDbFilePath(databaseUrl: string): string {
  return databaseUrl.replace(/^file:/, '');
}

/**
 * The canonical MCP resource URL (RFC 8707) — the `/mcp` endpoint clients
 * connect to and the audience tokens are bound to. Normalized without a
 * trailing slash, per the MCP authorization spec.
 */
export function getMcpResourceUrl(env: Env): string {
  const raw = env.MCP_BASE_URL ?? `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/mcp`;
  return raw.replace(/\/$/, '');
}

/**
 * The origin (scheme://host[:port]) that hosts the OAuth authorization-server
 * and resource-metadata endpoints. Derived from the MCP resource URL so the
 * well-known documents and the protected resource share an origin.
 */
export function getMcpIssuer(env: Env): string {
  return new URL(getMcpResourceUrl(env)).origin;
}
