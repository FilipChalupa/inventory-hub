import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type AuthMe } from '../lib/api.js';
import { forgetUserOnDevice, readLastMe, rememberMe } from '../lib/deviceSession.js';
import { useLocale } from '../i18n/index.js';
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

  // The account mirrors the UI language (emails to the user follow it): it is
  // saved on sign-in when it differs, and again whenever the user switches.
  // The device's choice is never overridden by the account.
  const [locale] = useLocale();
  const savedLocale = me.data?.authenticated ? (me.data.user.locale ?? null) : undefined;
  useEffect(() => {
    if (savedLocale === undefined || savedLocale === locale) return;
    void apiClient.auth
      .setLocale(locale)
      .then(() =>
        qc.setQueryData<AuthMe>(['auth', 'me'], (old) =>
          old?.authenticated ? { ...old, user: { ...old.user, locale } } : old,
        ),
      )
      .catch(() => undefined);
  }, [locale, savedLocale, qc]);

  const value: AuthValue = {
    state: me.data,
    isLoading: me.isLoading,
    logout: async () => {
      await apiClient.auth.logout();
      await forgetUserOnDevice();
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
