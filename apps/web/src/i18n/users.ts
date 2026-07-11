import { ns } from './util.js';

export const users = ns({
  cs: {
    title: 'Uživatelé',
    introBefore:
      'Spravuj role a deaktivuj uživatele, kteří už nemají mít přístup. Pozvánky se zakládají v ',
    introSettingsLink: 'Nastavení',
    introAfter: '.',
    empty: 'Žádní uživatelé.',
    you: '(ty)',
    deactivatedAt: (date: string) => `deaktivován ${date}`,
    activate: 'Aktivovat',
    deactivate: 'Deaktivovat',
    confirmTitle: (email: string) => `Deaktivovat uživatele ${email}?`,
    confirmMessage: 'Ztratí přístup do aplikace. Lze ho později znovu aktivovat.',
    deactivated: 'Uživatel deaktivován',
    exportData: 'Exportovat data',
    exportFailed: 'Export dat se nezdařil',
    anonymize: 'Anonymizovat',
    anonymizeConfirmTitle: (email: string) => `Anonymizovat uživatele ${email}?`,
    anonymizeConfirmMessage:
      'Nevratné — smaže osobní údaje uživatele a odhlásí ho. Historie zůstane zachována, ale bez jména a e-mailu.',
    anonymized: 'Uživatel anonymizován',
  },
  en: {
    title: 'Users',
    introBefore:
      'Manage roles and deactivate users who should no longer have access. Invitations are created in ',
    introSettingsLink: 'Settings',
    introAfter: '.',
    empty: 'No users.',
    you: '(you)',
    deactivatedAt: (date: string) => `deactivated ${date}`,
    activate: 'Activate',
    deactivate: 'Deactivate',
    confirmTitle: (email: string) => `Deactivate user ${email}?`,
    confirmMessage: 'They will lose access to the app. You can reactivate them later.',
    deactivated: 'User deactivated',
    exportData: 'Export data',
    exportFailed: 'Data export failed',
    anonymize: 'Anonymize',
    anonymizeConfirmTitle: (email: string) => `Anonymize user ${email}?`,
    anonymizeConfirmMessage:
      'Irreversible — this erases the user’s personal data and signs them out. History is kept, but without their name and email.',
    anonymized: 'User anonymized',
  },
});
