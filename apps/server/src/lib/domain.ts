import type { AllowedDomain } from '@inventory-hub/shared';

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * Returns the matching AllowedDomain for the email, or null.
 * Match is strict exact — `acme.com` does NOT match `eng.acme.com`.
 */
export function matchAllowedDomain(
  email: string,
  allowed: AllowedDomain[],
): AllowedDomain | null {
  const domain = emailDomain(email);
  if (!domain) return null;
  return allowed.find((d) => d.domain.toLowerCase() === domain) ?? null;
}
