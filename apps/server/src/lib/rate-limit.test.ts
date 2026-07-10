import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { _resetRateLimits, rateLimit } from './rate-limit.js';

describe('rateLimit', () => {
  beforeEach(() => {
    _resetRateLimits();
  });
  afterEach(() => {
    _resetRateLimits();
  });

  it('allows up to `max` requests then returns 429', async () => {
    const app = new Hono().get('/', rateLimit({ bucket: 't1', windowMs: 60_000, max: 3 }), (c) =>
      c.text('ok'),
    );
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/');
      expect(res.status).toBe(200);
    }
    const blocked = await app.request('/');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('treats different IPs as separate buckets', async () => {
    const app = new Hono().get('/', rateLimit({ bucket: 't2', windowMs: 60_000, max: 1 }), (c) =>
      c.text('ok'),
    );
    const a1 = await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    const a2 = await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(429);

    const b1 = await app.request('/', { headers: { 'x-forwarded-for': '2.2.2.2' } });
    expect(b1.status).toBe(200);
  });

  it('different buckets do not interfere', async () => {
    const app = new Hono()
      .get('/a', rateLimit({ bucket: 'a', windowMs: 60_000, max: 1 }), (c) => c.text('ok'))
      .get('/b', rateLimit({ bucket: 'b', windowMs: 60_000, max: 1 }), (c) => c.text('ok'));

    const a1 = await app.request('/a');
    const a2 = await app.request('/a');
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(429);

    const b1 = await app.request('/b');
    expect(b1.status).toBe(200);
  });

  it('honours x-forwarded-for chain (first IP wins)', async () => {
    const app = new Hono().get('/', rateLimit({ bucket: 't3', windowMs: 60_000, max: 1 }), (c) =>
      c.text('ok'),
    );
    const r1 = await app.request('/', {
      headers: { 'x-forwarded-for': '3.3.3.3, 10.0.0.1' },
    });
    const r2 = await app.request('/', {
      headers: { 'x-forwarded-for': '3.3.3.3, 10.0.0.2' }, // same first IP
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(429);
  });
});
