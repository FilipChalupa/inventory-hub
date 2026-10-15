import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

export type UiLocale = 'cs' | 'en';

/** Cookie the web app mirrors its chosen UI language into. */
export const LOCALE_COOKIE = 'ih_locale';

/**
 * Language for server-rendered pages (OAuth consent, error pages): the user's
 * choice in the web app (cookie) wins, then the browser's Accept-Language,
 * then the org default.
 */
export function requestLocale(c: Context, fallback: UiLocale = 'cs'): UiLocale {
  const cookie = getCookie(c, LOCALE_COOKIE);
  if (cookie === 'cs' || cookie === 'en') return cookie;
  const header = c.req.header('accept-language') ?? '';
  for (const part of header.split(',')) {
    const base = part.trim().split(';')[0]?.toLowerCase().split('-')[0];
    if (base === 'cs' || base === 'en') return base;
  }
  return fallback;
}
