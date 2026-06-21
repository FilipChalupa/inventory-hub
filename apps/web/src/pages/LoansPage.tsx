import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient, type LoanRow } from '../lib/api.js';
import { Button, Card, Input, Select, formatDate } from '../components/ui.js';
import { LoansCalendar } from '../components/LoansCalendar.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { useT } from '../i18n/index.js';
import clsx from 'clsx';

const statusClasses = {
  planned: 'bg-violet-100 text-violet-800',
  open: 'bg-amber-100 text-amber-800',
  partially_returned: 'bg-blue-100 text-blue-800',
  fully_returned: 'bg-emerald-100 text-emerald-800',
} as const;

type StatusFilter = '' | keyof typeof statusClasses | 'overdue';

export function LoansPage() {
  const t = useT();
  const now = new Date();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'calendar' ? 'calendar' : 'list';
  const [status, setStatus] = useState<StatusFilter>('');
  const [borrower, setBorrower] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(100);
  const debouncedBorrower = useDebouncedValue(borrower);

  // Borrower search and paging are server-side (so the list isn't silently
  // capped); status/date/overdue refine the loaded page client-side.
  const list = useQuery({
    queryKey: ['loans', { q: debouncedBorrower, limit }],
    queryFn: () => apiClient.loans.list({ q: debouncedBorrower || undefined, limit }),
    placeholderData: keepPreviousData,
    enabled: view === 'list',
  });
  const total = list.data?.total ?? 0;
  const loadedCount = list.data?.items.length ?? 0;

  const filtered = useMemo(() => {
    if (!list.data) return [];
    return list.data.items.filter((loan) => {
      if (status === 'overdue') {
        const isOverdue =
          loan.status !== 'fully_returned' &&
          loan.status !== 'planned' &&
          loan.expectedReturnAt &&
          new Date(loan.expectedReturnAt) < now;
        if (!isOverdue) return false;
      } else if (status && loan.status !== status) {
        return false;
      }
      if (from) {
        const fromDate = new Date(from);
        if (new Date(loan.loanedAt) < fromDate) return false;
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        if (new Date(loan.loanedAt) > toDate) return false;
      }
      return true;
    });
  }, [list.data, status, from, to, now]);

  // Planned loans get their own "upcoming" section, sorted by start date.
  const upcoming = filtered
    .filter((l) => l.status === 'planned')
    .slice()
    .sort((a, b) => new Date(a.loanedAt).getTime() - new Date(b.loanedAt).getTime());
  const others = filtered.filter((l) => l.status !== 'planned');

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.loans.title}</h1>
        <Link to="/loans/new">
          <Button>{t.loans.newLoan}</Button>
        </Link>
      </div>

      <div className="inline-flex rounded border border-slate-300 dark:border-slate-600 overflow-hidden text-sm">
        <ViewTab active={view === 'list'} onClick={() => setSearchParams({})}>
          {t.loans.viewList}
        </ViewTab>
        <ViewTab active={view === 'calendar'} onClick={() => setSearchParams({ view: 'calendar' })}>
          {t.loans.viewCalendar}
        </ViewTab>
      </div>

      {view === 'calendar' && <LoansCalendar />}

      {view === 'list' && (loadedCount > 0 || borrower || status || from || to) && (
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-slate-500 block mb-0.5">{t.loans.borrower}</label>
            <Input
              type="search"
              value={borrower}
              onChange={(e) => setBorrower(e.target.value)}
              placeholder={t.loans.borrowerPlaceholder}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-0.5">{t.loans.status}</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="">{t.loans.statusAll}</option>
              <option value="planned">{t.loanStatuses.planned}</option>
              <option value="open">{t.loanStatuses.open}</option>
              <option value="partially_returned">{t.loanStatuses.partially_returned}</option>
              <option value="fully_returned">{t.loanStatuses.fully_returned}</option>
              <option value="overdue">{t.loanStatuses.overdue}</option>
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-0.5">{t.loans.from}</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-0.5">{t.loans.to}</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {(status || borrower || from || to) && (
            <Button
              variant="ghost"
              className="text-xs"
              onClick={() => {
                setStatus('');
                setBorrower('');
                setFrom('');
                setTo('');
              }}
            >
              {t.loans.clear}
            </Button>
          )}
        </div>
      )}

      {view === 'list' && loadedCount === 0 && !borrower && (
        <Card>
          <h2 className="font-semibold mb-1">{t.loans.emptyTitle}</h2>
          <p className="text-slate-600 text-sm mb-3">{t.loans.emptyBody}</p>
          <Link to="/loans/new">
            <Button>{t.loans.createFirst}</Button>
          </Link>
        </Card>
      )}

      {view === 'list' &&
        ((loadedCount > 0 && filtered.length === 0) || (loadedCount === 0 && !!borrower)) && (
          <p className="text-sm text-slate-500">{t.loans.noMatch}</p>
        )}

      {view === 'list' && upcoming.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            {t.loans.upcoming}
          </h2>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
            {upcoming.map((loan) => (
              <LoanRowItem key={loan.id} loan={loan} now={now} />
            ))}
          </ul>
        </div>
      )}

      {view === 'list' && others.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
          {others.map((loan) => (
            <LoanRowItem key={loan.id} loan={loan} now={now} />
          ))}
        </ul>
      )}

      {view === 'list' && loadedCount < total && (
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={list.isFetching}
            onClick={() => setLimit((l) => l + 100)}
          >
            {list.isFetching ? t.common.loading : t.common.loadMore}
          </Button>
          <span className="text-xs text-slate-500">{t.loans.shownOf(loadedCount, total)}</span>
        </div>
      )}
    </section>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'px-3 py-1.5 transition-colors',
        active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
      )}
    >
      {children}
    </button>
  );
}

function LoanRowItem({ loan, now }: { loan: LoanRow; now: Date }) {
  const t = useT();
  const overdue =
    loan.status !== 'fully_returned' &&
    loan.status !== 'planned' &&
    loan.expectedReturnAt &&
    new Date(loan.expectedReturnAt) < now;
  return (
    <li className="hover:bg-slate-50 dark:hover:bg-slate-700">
      <Link to={`/loans/${loan.id}`} className="flex items-center justify-between p-3 gap-4">
        <div>
          <div className="font-medium">{loan.borrowerName}</div>
          <div className="text-xs text-slate-500">
            {t.loans.pieces(loan.items.length)} ·{' '}
            {loan.status === 'planned'
              ? t.loans.startsAt(formatDate(loan.loanedAt))
              : t.loans.lentAt(formatDate(loan.startedAt ?? loan.loanedAt))}
            {loan.expectedReturnAt && ` · ${t.loans.returnBy(formatDate(loan.expectedReturnAt))}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {overdue && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium">
              {t.loans.overdue}
            </span>
          )}
          <span
            className={clsx('text-xs px-2 py-0.5 rounded font-medium', statusClasses[loan.status])}
          >
            {t.loanStatuses[loan.status]}
          </span>
        </div>
      </Link>
    </li>
  );
}
