import { ns } from './util.js';

export const dashboard = ns({
  cs: {
    title: 'Přehled',
    subtitle: 'Stav inventáře na první pohled',
    empty: 'Zatím tu nejsou žádná data. Přidej první majetek.',
    // Stat tiles
    totalActive: 'Aktivní majetek',
    onLoan: 'Vypůjčeno',
    overdue: 'Po termínu',
    inRepair: 'V opravě',
    planned: 'Naplánováno',
    // Sections
    byStatus: 'Podle stavu',
    byType: 'Podle typu',
    byLocation: 'Podle lokace',
    noType: 'Bez typu',
    noData: 'Žádná data',
    pieces: (n: number) => `${n} ks`,
  },
  en: {
    title: 'Dashboard',
    subtitle: 'Inventory status at a glance',
    empty: 'No data yet. Add your first asset.',
    // Stat tiles
    totalActive: 'Active assets',
    onLoan: 'On loan',
    overdue: 'Overdue',
    inRepair: 'In repair',
    planned: 'Planned',
    // Sections
    byStatus: 'By status',
    byType: 'By type',
    byLocation: 'By location',
    noType: 'No type',
    noData: 'No data',
    pieces: (n: number) => `${n} pcs`,
  },
});
