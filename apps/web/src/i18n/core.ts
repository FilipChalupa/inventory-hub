import { ns } from './util.js';

/** Navigation labels. */
export const nav = ns({
  cs: {
    assets: 'Assety',
    scan: 'Sken',
    loans: 'Výpůjčky',
    calendar: 'Kalendář',
    inventory: 'Inventury',
    labels: 'Štítky',
    types: 'Typy',
    locations: 'Lokace',
    contacts: 'Kontakty',
    audit: 'Audit',
    users: 'Uživatelé',
    settings: 'Nastavení',
    catalog: 'Číselníky',
    logout: 'Odhlásit',
  },
  en: {
    assets: 'Assets',
    scan: 'Scan',
    loans: 'Loans',
    calendar: 'Calendar',
    inventory: 'Inventories',
    labels: 'Labels',
    types: 'Types',
    locations: 'Locations',
    contacts: 'Contacts',
    audit: 'Audit',
    users: 'Users',
    settings: 'Settings',
    catalog: 'Catalog',
    logout: 'Sign out',
  },
});

/** Asset lifecycle status labels (keyed by the DB enum). */
export const assetStatuses = ns({
  cs: {
    in_stock: 'Skladem',
    assigned: 'Přiřazeno',
    on_loan: 'Vypůjčeno',
    in_repair: 'V opravě',
    damaged: 'Poškozeno',
    sold: 'Prodáno',
    lost: 'Ztraceno',
    retired: 'Vyřazeno',
  },
  en: {
    in_stock: 'In stock',
    assigned: 'Assigned',
    on_loan: 'On loan',
    in_repair: 'In repair',
    damaged: 'Damaged',
    sold: 'Sold',
    lost: 'Lost',
    retired: 'Retired',
  },
});

/** Loan status labels (derived loan state). */
export const loanStatuses = ns({
  cs: {
    planned: 'Naplánováno',
    open: 'Otevřená',
    partially_returned: 'Část vráceno',
    fully_returned: 'Vráceno',
    overdue: 'Po termínu',
  },
  en: {
    planned: 'Planned',
    open: 'Open',
    partially_returned: 'Partially returned',
    fully_returned: 'Returned',
    overdue: 'Overdue',
  },
});

/** Common buttons / shared words reused across screens. */
export const common = ns({
  cs: {
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
    search: 'Hledat…',
    loadMore: 'Načíst další',
    copy: 'Kopírovat',
    copied: 'Zkopírováno',
    role: 'Role',
    required: 'Povinné',
    roles: {
      admin: 'Administrátor',
      operator: 'Operátor',
      member: 'Člen',
      auditor: 'Auditor',
    } as Record<string, string>,
  },
  en: {
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    confirm: 'Confirm',
    back: 'back',
    loading: 'Loading…',
    saving: 'Saving…',
    none: '—',
    archived: 'archived',
    search: 'Search…',
    loadMore: 'Load more',
    copy: 'Copy',
    copied: 'Copied',
    role: 'Role',
    required: 'Required',
    roles: {
      admin: 'Admin',
      operator: 'Operator',
      member: 'Member',
      auditor: 'Auditor',
    } as Record<string, string>,
  },
});
