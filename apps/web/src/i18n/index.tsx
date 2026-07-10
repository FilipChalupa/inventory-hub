import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { LOCALES, type Locale } from './util.js';
import { nav, assetStatuses, loanStatuses, common } from './core.js';
import { today } from './today.js';
import { login } from './login.js';
import { acceptInvite } from './acceptInvite.js';
import { contacts } from './contacts.js';
import { users } from './users.js';
import { assetTypes } from './assetTypes.js';
import { locations } from './locations.js';
import { audit } from './audit.js';
import { scan } from './scan.js';
import { assetDetail } from './assetDetail.js';
import { assets } from './assets.js';
import { newAsset } from './newAsset.js';
import { settings } from './settings.js';
import { loans } from './loans.js';
import { newLoan } from './newLoan.js';
import { loanDetail } from './loanDetail.js';
import { inventory } from './inventory.js';
import { inventorySession } from './inventorySession.js';
import { calendar } from './calendar.js';
import { loansCalendar } from './loansCalendar.js';
import { availabilityCalendar } from './availabilityCalendar.js';
import { labels } from './labels.js';
import { importAssets } from './importAssets.js';
import { components } from './components.js';

// Compose every namespace into one catalog per locale. Add a namespace here
// when you create its file; pages then read it as `t.<namespace>.<key>`.
const catalog = {
  cs: {
    nav: nav.cs,
    assetStatuses: assetStatuses.cs,
    loanStatuses: loanStatuses.cs,
    common: common.cs,
    today: today.cs,
    login: login.cs,
    acceptInvite: acceptInvite.cs,
    contacts: contacts.cs,
    users: users.cs,
    assetTypes: assetTypes.cs,
    locations: locations.cs,
    audit: audit.cs,
    scan: scan.cs,
    assetDetail: assetDetail.cs,
    assets: assets.cs,
    newAsset: newAsset.cs,
    settings: settings.cs,
    loans: loans.cs,
    newLoan: newLoan.cs,
    loanDetail: loanDetail.cs,
    inventory: inventory.cs,
    inventorySession: inventorySession.cs,
    calendar: calendar.cs,
    loansCalendar: loansCalendar.cs,
    availabilityCalendar: availabilityCalendar.cs,
    labels: labels.cs,
    importAssets: importAssets.cs,
    components: components.cs,
  },
  en: {
    nav: nav.en,
    assetStatuses: assetStatuses.en,
    loanStatuses: loanStatuses.en,
    common: common.en,
    today: today.en,
    login: login.en,
    acceptInvite: acceptInvite.en,
    contacts: contacts.en,
    users: users.en,
    assetTypes: assetTypes.en,
    locations: locations.en,
    audit: audit.en,
    scan: scan.en,
    assetDetail: assetDetail.en,
    assets: assets.en,
    newAsset: newAsset.en,
    settings: settings.en,
    loans: loans.en,
    newLoan: newLoan.en,
    loanDetail: loanDetail.en,
    inventory: inventory.en,
    inventorySession: inventorySession.en,
    calendar: calendar.en,
    loansCalendar: loansCalendar.en,
    availabilityCalendar: availabilityCalendar.en,
    labels: labels.en,
    importAssets: importAssets.en,
    components: components.en,
  },
};

export type Messages = (typeof catalog)['cs'];

const STORAGE_KEY = 'ih.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall through to detection.
  }
  // No saved choice → follow the browser's preferred languages, picking the
  // first that maps to a locale we ship; default to Czech otherwise.
  if (typeof navigator !== 'undefined') {
    const prefs = navigator.languages ?? [navigator.language];
    for (const pref of prefs) {
      const base = pref?.toLowerCase().split('-')[0];
      const match = LOCALES.find((l) => l === base);
      if (match) return match;
    }
  }
  return 'cs';
}

// Mirror of the active locale at module scope, kept in sync by the provider.
// Lets non-component helpers (formatDate, availability labels, errorMessage)
// pick the right language without threading the hook everywhere.
let activeLocale: Locale = 'cs';
export function getLocale(): Locale {
  return activeLocale;
}

type I18nContextValue = { locale: Locale; setLocale: (l: Locale) => void; t: Messages };
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  // Keep the module mirror in sync for non-component helpers (runs before
  // children render, so they read the current locale this pass).
  activeLocale = locale;
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
