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

function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}

export function rateLimit(options: RateLimitOptions) {
  return createMiddleware<AppContext>(async (c, next) => {
    const ip = clientIp(c.req.raw.headers);
    let map = buckets.get(options.bucket);
    if (!map) {
      map = new Map();
      buckets.set(options.bucket, map);
    }
    const now = Date.now();
    let entry = map.get(ip);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + options.windowMs };
      map.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > options.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return c.json(
        {
          error: {
            message: `Příliš mnoho požadavků, zkus to za ${retryAfter}s.`,
          },
        },
        429,
        { 'Retry-After': String(retryAfter) },
      );
    }
    await next();
  });
}

/**
 * Test-only: wipe all buckets so tests don't leak state across cases.
 */
export function _resetRateLimits(): void {
  buckets.clear();
}
