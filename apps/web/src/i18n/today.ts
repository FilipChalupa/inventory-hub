import { ns } from './util.js';

export const today = ns({
  cs: {
    title: 'Dnes',
    overdue: 'Po termínu',
    overdueEmpty: 'Nic není po termínu 🎉',
    dueToday: 'Vrátit dnes',
    dueTodayEmpty: 'Dnes se nic nevrací.',
    startingToday: 'Začíná dnes',
    startingTodayEmpty: 'Dnes nezačíná žádná rezervace.',
    pieces: (n: number) => `${n} ks`,
  },
  en: {
    title: 'Today',
    overdue: 'Overdue',
    overdueEmpty: 'Nothing overdue 🎉',
    dueToday: 'Due today',
    dueTodayEmpty: 'Nothing due today.',
    startingToday: 'Starting today',
    startingTodayEmpty: 'No reservations start today.',
    pieces: (n: number) => `${n} pcs`,
  },
});
