import { z } from 'zod';

/**
 * Capabilities a key grants, chosen at creation. Scopes are independent:
 * - `api`   — authenticate REST `/api/*` requests as the creating user/role.
 * - `feeds` — read subscribable calendar feeds (`/feeds/*.ics`).
 *
 * A calendar URL embeds its token in the address (calendar clients can't send
 * headers), so it leaks easily — into Google/Apple servers, logs, browser
 * history. A `feeds`-only key keeps that exposure harmless: it can't touch the
 * REST API even if the URL escapes.
 */
export const apiKeyScopes = ['api', 'feeds'] as const;
export const apiKeyScopeSchema = z.enum(apiKeyScopes);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const createApiKeyInput = z.object({
  name: z.string().trim().min(1).max(100),
  // At least one capability; defaults to full API access for backwards compat.
  scopes: z.array(apiKeyScopeSchema).min(1).default(['api']),
  // Optional expiry; omit for a non-expiring key.
  expiresAt: z.coerce.date().nullable().optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeyInput>;
