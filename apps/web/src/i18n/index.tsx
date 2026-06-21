import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LOCALES, type Locale } from './util.js';
import { nav, assetStatuses, loanStatuses, common } from './core.js';
import { today } from './today.js';

// Compose every namespace into one catalog per locale. Add a namespace here
// when you create its file; pages then read it as `t.<namespace>.<key>`.
const catalog = {
  cs: {
    nav: nav.cs,
    assetStatuses: assetStatuses.cs,
    loanStatuses: loanStatuses.cs,
    common: common.cs,
    today: today.cs,
  },
  en: {
    nav: nav.en,
    assetStatuses: assetStatuses.en,
    loanStatuses: loanStatuses.en,
    common: common.en,
    today: today.en,
  },
};

export type Messages = (typeof catalog)['cs'];

const STORAGE_KEY = 'ih.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall through to default.
  }
  return 'cs';
}

type I18nContextValue = { locale: Locale; setLocale: (l: Locale) => void; t: Messages };
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((l: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore persistence failures
    }
    setLocaleState(l);
  }, []);
  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: catalog[locale] }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The active locale's message catalog. Re-renders consumers on locale change. */
export function useT(): Messages {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used within <I18nProvider>');
  return ctx.t;
}

/** [currentLocale, setLocale] for the language switcher. */
export function useLocale(): [Locale, (l: Locale) => void] {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useLocale must be used within <I18nProvider>');
  return [ctx.locale, ctx.setLocale];
}
