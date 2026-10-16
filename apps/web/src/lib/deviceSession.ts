/**
 * What this browser keeps about the signed-in user beyond the session
 * cookie — and how it forgets it. Matters on shared warehouse tablets.
 *
 * The last confirmed /auth/me is remembered so the app can start offline
 * (see AuthContext). It is never kept on a device marked as shared, expires
 * with the server session's lifetime, and is wiped (with cached API data)
 * whenever the server answers 401 — i.e. the session is gone.
 */
import type { AuthMe } from './api.js';

const LAST_ME_KEY = 'ih.lastMe';
const SHARED_DEVICE_KEY = 'ih.sharedDevice';
/** Mirrors the server's SESSION_TTL_MS (30 days). */
const LAST_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function isSharedDevice(): boolean {
  return storage()?.getItem(SHARED_DEVICE_KEY) === '1';
}

export function setSharedDevice(shared: boolean): void {
  const s = storage();
  if (!s) return;
  try {
    if (shared) {
      s.setItem(SHARED_DEVICE_KEY, '1');
      s.removeItem(LAST_ME_KEY);
    } else {
      s.removeItem(SHARED_DEVICE_KEY);
    }
  } catch {
    // ignore
  }
}

export function rememberMe(me: AuthMe): void {
  const s = storage();
  if (!s) return;
  try {
    if (me.authenticated && !isSharedDevice()) {
      s.setItem(LAST_ME_KEY, JSON.stringify({ me, savedAt: Date.now() }));
    } else {
      s.removeItem(LAST_ME_KEY);
    }
  } catch {
    // ignore
  }
}

export function readLastMe(now = Date.now()): AuthMe | undefined {
  if (isSharedDevice()) return undefined;
  try {
    const raw = storage()?.getItem(LAST_ME_KEY);
    if (!raw) return undefined;
    const { me, savedAt } = JSON.parse(raw) as { me?: AuthMe; savedAt?: number };
    if (!me || typeof savedAt !== 'number' || now - savedAt > LAST_ME_MAX_AGE_MS) return undefined;
    return me;
  } catch {
    return undefined;
  }
}

/**
 * Drops every cached `/api/*` response from the service-worker Cache Storage
 * (the SW caches API GETs stale-while-revalidate). Best-effort.
 */
export async function purgeApiCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((r) => new URL(r.url).pathname.startsWith('/api/'))
          .map((r) => cache.delete(r)),
      );
    }
  } catch {
    // never block on cache cleanup
  }
}

/** Forget the user on this device: remembered identity + cached API data. */
export async function forgetUserOnDevice(): Promise<void> {
  try {
    storage()?.removeItem(LAST_ME_KEY);
  } catch {
    // ignore
  }
  await purgeApiCache();
}
