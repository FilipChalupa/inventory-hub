/* eslint-env serviceworker */
/* global self, caches, fetch, Response */

/**
 * Inventory Hub service worker — read-only offline support.
 *
 * Strategy:
 *  - /auth/*: pass through to the network, never cached. These depend on the
 *    session cookie + login state; caching them breaks auth (login loop).
 *  - SPA shell (navigations): network-first, fall back to cached `/index.html`.
 *    Lets the user keep browsing the last-viewed pages when the connection
 *    drops, but doesn't show stale shell when online.
 *  - GET /api/*: stale-while-revalidate. Cached responses appear instantly,
 *    a background fetch refreshes them.
 *  - Static assets (JS/CSS/fonts/QR PNGs): cache-first.
 *  - Writes (POST/PATCH/DELETE): pass through — we intentionally do NOT queue
 *    offline writes. The UI surfaces a banner so the operator knows.
 */

const CACHE_NAME = 'inv-hub-v3';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // writes always pass through

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ignore cross-origin (e.g. Google avatars)

  // Auth endpoints (/auth/me, OAuth start/callback, …) must NEVER be cached:
  // they depend on the session cookie and the current login state. Caching
  // /auth/me once while logged out would pin `{authenticated:false}` forever
  // (cache-first) and trap the user in a login loop. Pass straight to network.
  if (url.pathname.startsWith('/auth/')) return;

  // Navigations → network-first with shell fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (
          (await cache.match(req)) ||
          (await cache.match('/index.html')) ||
          new Response('Offline', { status: 503, statusText: 'Offline' })
        );
      }),
    );
    return;
  }

  // API GETs → stale-while-revalidate.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Anything else (assets/static) → cache-first.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })(),
  );
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    // Refresh in the background, return cached immediately.
    network.catch(() => undefined);
    return cached;
  }
  const fresh = await network;
  return fresh || new Response('Offline', { status: 503, statusText: 'Offline' });
}
