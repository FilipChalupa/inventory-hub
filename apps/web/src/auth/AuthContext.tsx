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

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.auth.me(),
    staleTime: 60_000,
    retry: false,
  });

  const value: AuthValue = {
    state: me.data,
    isLoading: me.isLoading,
    logout: async () => {
      await apiClient.auth.logout();
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
