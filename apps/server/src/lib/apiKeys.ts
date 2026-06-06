import { createHash, randomBytes } from 'node:crypto';

/** Human-recognisable prefix so leaked keys are greppable / identifiable. */
export const API_KEY_TOKEN_PREFIX = 'ihk_';

/** SHA-256 hex digest — only the hash is stored at rest. */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Mints a new API key. Returns the raw `token` (shown to the user exactly
 * once), its `hash` (stored), and a short `prefix` kept in plaintext so the
 * key can be identified in listings.
 */
export function generateApiKey(): { token: string; hash: string; prefix: string } {
  const token = API_KEY_TOKEN_PREFIX + randomBytes(24).toString('base64url');
  return { token, hash: hashApiKey(token), prefix: token.slice(0, 12) };
}
