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
