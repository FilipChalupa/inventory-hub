import { ns } from './util.js';

/** In-app notification centre (the navigation bell + dropdown panel). */
export const notifications = ns({
  cs: {
    title: 'Notifikace',
    open: 'Otevřít notifikace',
    unread: (n: number) => `${n} nepřečtených`,
    empty: 'Žádné notifikace',
    markAllRead: 'Označit vše jako přečtené',
    error: 'Notifikace se nepodařilo načíst',
  },
  en: {
    title: 'Notifications',
    open: 'Open notifications',
    unread: (n: number) => `${n} unread`,
    empty: 'No notifications',
    markAllRead: 'Mark all as read',
    error: 'Failed to load notifications',
  },
});
