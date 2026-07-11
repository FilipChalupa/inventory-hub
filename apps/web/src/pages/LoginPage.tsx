import { useState } from 'react';
import { errorMessage } from '../lib/errors.js';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input } from '../components/ui.js';
import { useT } from '../i18n/index.js';

const SELF_HOSTING_DOCS_URL =
  'https://github.com/FilipChalupa/inventory-hub/blob/main/docs/SELF_HOSTING.md#environment-variables';

export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('admin@example.com');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which sign-in methods this deployment actually offers. Optimistic defaults
  // (Google on, dev mirrors the build) avoid a guidance flash on the common
  // configured-Google deploy while the probe is in flight.
  const { data: config } = useQuery({
    queryKey: ['auth', 'config'],
    queryFn: () => apiClient.auth.config(),
    staleTime: Infinity,
  });
  const googleConfigured = config?.googleConfigured ?? true;
  const devLoginEnabled = config?.devLoginEnabled ?? import.meta.env.DEV;
  // Nothing to offer: server has no Google OAuth and dev login is off (prod).
  const lockedOut = config != null && !googleConfigured && !devLoginEnabled;

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.auth.devLogin(email);
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Inventory Hub</h1>
          <p className="text-sm text-slate-600">{t.login.subtitle}</p>
        </div>

        {googleConfigured && (
          <a
            href={apiClient.auth.googleStartUrl}
            className="flex items-center justify-center gap-2 w-full rounded border border-slate-300 bg-white text-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.997 10.997 0 0 0 12 23Z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.997 10.997 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A10.997 10.997 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
              />
            </svg>
            {t.login.continueWithGoogle}
          </a>
        )}

        {lockedOut && (
          <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700/60 dark:bg-amber-900/20">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              {t.login.noMethodTitle}
            </p>
            <p className="mt-1 text-amber-800 dark:text-amber-300">{t.login.noMethodBody}</p>
            <a
              href={SELF_HOSTING_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-medium text-amber-900 underline dark:text-amber-200"
            >
              {t.login.setupGuide}
            </a>
          </div>
        )}

        {devLoginEnabled && (
          <>
            {googleConfigured && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-700"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {t.login.devMode}
                  </span>
                </div>
              </div>
            )}
            <form className="space-y-3" onSubmit={devLogin}>
              <Field label={t.login.existingUserEmail} required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                />
              </Field>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? t.login.signingIn : t.login.devLogin}
              </Button>
              <p className="text-xs text-slate-500">
                {t.login.devLoginHint}
                <code className="font-mono">db:seed</code>
                {t.login.devLoginHintEnd}
              </p>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
