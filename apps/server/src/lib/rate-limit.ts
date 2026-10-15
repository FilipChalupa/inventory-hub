import { createMiddleware } from 'hono/factory';
import type { AppContext } from '../app.js';

type Entry = { count: number; resetAt: number };

/**
 * Tiny in-memory sliding-window rate limiter. Keyed by IP + bucket name.
 * Resets per-bucket every `windowMs`. Fine for a single-instance deploy
 * (our self-hosted target); a multi-replica setup would need Redis.
 */
const buckets = new Map<string, Map<string, Entry>>();

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  bucket: string;
};

export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Counts one hit for `key` in `bucket`. Returns how long to wait when the
 * limit is exceeded, or null when the request may proceed. Usable outside
 * middleware, e.g. to key on an authenticated token instead of the IP.
 */
export function hitRateLimit(
  options: RateLimitOptions,
  key: string,
): { retryAfter: number } | null {
  let map = buckets.get(options.bucket);
  if (!map) {
    map = new Map();
    buckets.set(options.bucket, map);
  }
  const now = Date.now();
  let entry = map.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + options.windowMs };
    map.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > options.max) return { retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  return null;
}

export function rateLimit(options: RateLimitOptions) {
  return createMiddleware<AppContext>(async (c, next) => {
    const limited = hitRateLimit(options, clientIp(c.req.raw.headers));
    if (limited) {
      return c.json(
        {
          error: {
            message: `Příliš mnoho požadavků, zkus to za ${limited.retryAfter}s.`,
          },
        },
        429,
        { 'Retry-After': String(limited.retryAfter) },
      );
    }
    await next();
  });
}

/**
 * Drops expired entries (and any bucket left empty) so the in-memory maps
 * don't grow unbounded with one entry per distinct client IP. Safe to call
 * periodically; the per-request path re-creates entries lazily.
 */
export function pruneRateLimits(): void {
  const now = Date.now();
  for (const [bucketName, map] of buckets) {
    for (const [ip, entry] of map) {
      if (entry.resetAt < now) map.delete(ip);
    }
    if (map.size === 0) buckets.delete(bucketName);
  }
}

/**
 * Test-only: wipe all buckets so tests don't leak state across cases.
 */
export function _resetRateLimits(): void {
  buckets.clear();
}
