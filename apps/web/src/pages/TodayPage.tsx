import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { Link } from 'react-router-dom';
import { apiClient, type LoanTodayBucket } from '../lib/api.js';
import { Card, SkeletonList, formatDate } from '../components/ui.js';
import { useT, getLocale } from '../i18n/index.js';
import { localeTag } from '../i18n/util.js';

/**
 * Operational "what needs attention today" view: overdue returns, returns due
 * today, and reservations starting today. Buckets are computed server-side so
 * nothing is silently capped.
 */
export function TodayPage() {
  const t = useT();
  const now = new Date();
  const todayQuery = useQuery({
    queryKey: ['loans-today'],
    queryFn: () => apiClient.loans.today(),
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.today.title}</h1>
        <span className="text-sm text-slate-500">{now.toLocaleDateString(localeTag(getLocale()))}</span>
      </div>

      {todayQuery.isLoading && <SkeletonList rows={3} />}
      {todayQuery.error && <p className="text-red-600">{errorMessage(todayQuery.error)}</p>}

      {todayQuery.data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <LoanGroup
            title={t.today.overdue}
            tone="danger"
            loans={todayQuery.data.overdue}
            empty={t.today.overdueEmpty}
          />
          <LoanGroup
            title={t.today.dueToday}
            tone="warning"
            loans={todayQuery.data.dueToday}
            empty={t.today.dueTodayEmpty}
          />
          <LoanGroup
            title={t.today.startingToday}
            tone="info"
            loans={todayQuery.data.startingToday}
            empty={t.today.startingTodayEmpty}
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
  empty,
}: {
  title: string;
  tone: keyof typeof toneStyles;
  loans: LoanTodayBucket[];
  empty: string;
}) {
  const t = useT();
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
                  <span className="text-xs text-slate-400"> · {t.today.pieces(loan.itemCount)}</span>
                </span>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {formatDate(loan.date)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
