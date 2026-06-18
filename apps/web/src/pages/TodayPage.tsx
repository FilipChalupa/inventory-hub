import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient, type LoanRow } from '../lib/api.js';
import { Card, formatDate } from '../components/ui.js';
import { isSameDay } from '../lib/availability.js';

/**
 * Operational "what needs attention today" view: overdue returns, returns due
 * today, and reservations starting today. Derived from the loans list.
 */
export function TodayPage() {
  const now = new Date();
  const list = useQuery({
    queryKey: ['loans', { q: '', limit: 200 }],
    queryFn: () => apiClient.loans.list({ limit: 200 }),
  });

  const { overdue, dueToday, startingToday } = useMemo(() => {
    const items = list.data?.items ?? [];
    const live = (l: LoanRow) => l.status !== 'fully_returned' && l.status !== 'planned';
    return {
      overdue: items.filter(
        (l) => live(l) && l.expectedReturnAt && new Date(l.expectedReturnAt) < now,
      ),
      dueToday: items.filter(
        (l) =>
          live(l) && l.expectedReturnAt && isSameDay(new Date(l.expectedReturnAt), now),
      ),
      startingToday: items.filter(
        (l) => l.status === 'planned' && isSameDay(new Date(l.loanedAt), now),
      ),
    };
  }, [list.data, now]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dnes</h1>
        <span className="text-sm text-slate-500">{now.toLocaleDateString('cs-CZ')}</span>
      </div>

      {list.isLoading && <p className="text-slate-500">Načítám…</p>}
      {list.error && <p className="text-red-600">{(list.error as Error).message}</p>}

      {list.data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <LoanGroup
            title="Po termínu"
            tone="danger"
            loans={overdue}
            dateOf={(l) => l.expectedReturnAt}
            empty="Nic není po termínu 🎉"
          />
          <LoanGroup
            title="Vrátit dnes"
            tone="warning"
            loans={dueToday}
            dateOf={(l) => l.expectedReturnAt}
            empty="Dnes se nic nevrací."
          />
          <LoanGroup
            title="Začíná dnes"
            tone="info"
            loans={startingToday}
            dateOf={(l) => l.loanedAt}
            empty="Dnes nezačíná žádná rezervace."
          />
        </div>
      )}
    </section>
  );
}

const toneStyles = {
  danger: 'text-red-700 dark:text-red-300',
  warning: 'text-amber-700 dark:text-amber-300',
  info: 'text-violet-700 dark:text-violet-300',
} as const;

function LoanGroup({
  title,
  tone,
  loans,
  dateOf,
  empty,
}: {
  title: string;
  tone: keyof typeof toneStyles;
  loans: LoanRow[];
  dateOf: (l: LoanRow) => string | null;
  empty: string;
}) {
  return (
    <Card>
      <h2 className={`font-semibold mb-2 ${toneStyles[tone]}`}>
        {title}
        <span className="ml-2 text-sm font-normal text-slate-400">{loans.length}</span>
      </h2>
      {loans.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {loans.map((loan) => (
            <li key={loan.id}>
              <Link
                to={`/loans/${loan.id}`}
                className="flex items-center justify-between gap-2 py-2 text-sm hover:underline"
              >
                <span className="truncate">
                  {loan.borrowerName}
                  <span className="text-xs text-slate-400"> · {loan.items.length} ks</span>
                </span>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {formatDate(dateOf(loan))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
