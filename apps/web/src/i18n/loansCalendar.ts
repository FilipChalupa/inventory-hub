import { ns } from './util.js';

export const loansCalendar = ns({
  cs: {
    prevMonth: 'Předchozí měsíc',
    nextMonth: 'Další měsíc',
    today: 'Dnes',
    barTitle: (borrowerName: string, itemCount: number) => `${borrowerName} (${itemCount} ks)`,
    legendReserved: 'Rezervováno',
    legendLoaned: 'Vypůjčeno',
    legendOverdue: 'Po termínu',
  },
  en: {
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    today: 'Today',
    barTitle: (borrowerName: string, itemCount: number) => `${borrowerName} (${itemCount} pcs)`,
    legendReserved: 'Reserved',
    legendLoaned: 'On loan',
    legendOverdue: 'Overdue',
  },
});
