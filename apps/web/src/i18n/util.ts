export const LOCALES = ['cs', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = { cs: 'Čeština', en: 'English' };

/**
 * Declares one translation namespace. `en` is type-checked to have exactly the
 * same shape as `cs` (same keys, same value/function signatures), so a missing
 * or mistyped English string is a compile error rather than a runtime gap.
 *
 *   export const assets = ns({ cs: { title: 'Assety' }, en: { title: 'Assets' } });
 */
export function ns<C extends Record<string, unknown>>(def: { cs: C; en: C }): { cs: C; en: C } {
  return def;
}
