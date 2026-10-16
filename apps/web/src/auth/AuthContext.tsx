import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type AuthMe } from '../lib/api.js';
import type { UserRole } from '@inventory-hub/shared';

type AuthValue = {
  state: AuthMe | undefined;
  isLoading: boolean;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | undefined>(undefined);

/**
 * Drops every cached `/api/*` response from the service-worker Cache Storage.
 * The SW caches API GETs stale-while-revalidate; without this a logout would
 * leave the previous user's data sitting in the cache, ready to flash on the
 * next login before the network refresh lands.
 */
async function purgeApiCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        await Promise.all(
          requests
            .filter((r) => new URL(r.url).pathname.startsWith('/api/'))
            .map((r) => cache.delete(r)),
        );
      }),
    );
  } catch {
    // Best-effort; never block logout on cache cleanup.
  }
}

/**
 * Last confirmed identity, so the app can start while offline (e.g. opening a
 * prepared inventory in a warehouse) instead of falling back to the login
 * page. Only name/role — the server still authenticates every request, and
 * offline the app only shows data already in the service-worker cache.
 */
const LAST_ME_KEY = 'ih.lastMe';

function readLastMe(): AuthMe | undefined {
  try {
    const raw = localStorage.getItem(LAST_ME_KEY);
    return raw ? (JSON.parse(raw) as AuthMe) : undefined;
  } catch {
    return undefined;
  }
}

function rememberMe(me: AuthMe): void {
  try {
    if (me.authenticated) localStorage.setItem(LAST_ME_KEY, JSON.stringify(me));
    else localStorage.removeItem(LAST_ME_KEY);
  } catch {
    // storage unavailable
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await apiClient.auth.me();
      rememberMe(res);
      return res;
    },
    staleTime: 60_000,
    retry: false,
    // Offline only: online we always wait for the server's answer, so a
    // logged-out user never sees a flash of the app.
    initialData: () => (navigator.onLine ? undefined : readLastMe()),
    initialDataUpdatedAt: 0,
  });

  const value: AuthValue = {
    state: me.data,
    isLoading: me.isLoading,
    logout: async () => {
      await apiClient.auth.logout();
      try {
        localStorage.removeItem(LAST_ME_KEY);
      } catch {
        // ignore
      }
      await purgeApiCache();
      await qc.invalidateQueries();
      qc.removeQueries({ queryKey: ['auth', 'me'] });
      window.location.assign('/login');
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useCurrentUser() {
  const { state } = useAuth();
  if (!state || !state.authenticated) return null;
  return state.user;
}

export function hasRole(user: { role: UserRole } | null, ...allowed: UserRole[]): boolean {
  if (!user) return false;
  return allowed.length === 0 || allowed.includes(user.role);
}
