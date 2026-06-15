/**
 * Centralised UI strings.
 *
 * The codebase is still mostly inline-Czech; this module is the seed for a
 * future i18n migration. Add a string here when:
 *   - it appears in multiple places (nav labels, status badges, common
 *     buttons, empty states), or
 *   - you anticipate localising it (English etc.).
 *
 * Keep the keys grouped by domain. The default export is just `cs` for
 * now; introduce `en` (and a runtime selector) when product asks for it.
 */

export const cs = {
  nav: {
    assets: 'Assety',
    scan: 'Sken',
    loans: 'Výpůjčky',
    inventory: 'Inventury',
    labels: 'Štítky',
    types: 'Typy',
    locations: 'Lokace',
    contacts: 'Kontakty',
    audit: 'Audit',
    users: 'Uživatelé',
    settings: 'Nastavení',
    catalog: 'Číselníky',
  },
  asset: {
    statuses: {
      in_stock: 'Skladem',
      assigned: 'Přiřazeno',
      on_loan: 'Vypůjčeno',
      in_repair: 'V opravě',
      damaged: 'Poškozeno',
      sold: 'Prodáno',
      lost: 'Ztraceno',
      retired: 'Vyřazeno',
    },
  },
  loan: {
    statuses: {
      open: 'Otevřená',
      partially_returned: 'Část vráceno',
      fully_returned: 'Vráceno',
    },
    overdue: 'overdue',
  },
  common: {
    cancel: 'Zrušit',
    save: 'Uložit',
    delete: 'Smazat',
    edit: 'Upravit',
    add: 'Přidat',
    confirm: 'Potvrdit',
    back: 'zpět',
    loading: 'Načítám…',
    saving: 'Ukládám…',
    none: '—',
    archived: 'archivováno',
  },
} as const;

export type Messages = typeof cs;

/**
 * Single locale for now. Wire a context + switcher when product needs EN.
 */
export const t = cs;
