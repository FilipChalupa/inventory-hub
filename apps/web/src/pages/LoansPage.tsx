import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, type LoanRow } from '../lib/api.js';
import { Button, Card, Input, Select, formatDate } from '../components/ui.js';
import clsx from 'clsx';

const statusLabels = {
  planned: 'Naplánováno',
  open: 'Otevřená',
  partially_returned: 'Část vráceno',
  fully_returned: 'Vráceno',
} as const;

const statusClasses = {
  planned: 'bg-violet-100 text-violet-800',
  open: 'bg-amber-100 text-amber-800',
  partially_returned: 'bg-blue-100 text-blue-800',
  fully_returned: 'bg-emerald-100 text-emerald-800',
} as const;

type StatusFilter = '' | keyof typeof statusLabels | 'overdue';

export function LoansPage() {
  const list = useQuery({ queryKey: ['loans'], queryFn: () => apiClient.loans.list() });
  const now = new Date();
  const [status, setStatus] = useState<StatusFilter>('');
  const [borrower, setBorrower] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

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
      if (borrower && !loan.borrowerName.toLowerCase().includes(borrower.toLowerCase())) {
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
  }, [list.data, status, borrower, from, to, now]);

  // Planned loans get their own "upcoming" section, sorted by start date.
  const upcoming = filtered
    .filter((l) => l.status === 'planned')
    .slice()
    .sort((a, b) => new Date(a.loanedAt).getTime() - new Date(b.loanedAt).getTime());
  const others = filtered.filter((l) => l.status !== 'planned');

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Výpůjčky</h1>
        <Link to="/loans/new">
          <Button>+ Nová výpůjčka</Button>
        </Link>
      </div>

      {list.data && list.data.items.length > 0 && (
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-slate-500 block mb-0.5">Borrower</label>
            <Input
              type="search"
              value={borrower}
              onChange={(e) => setBorrower(e.target.value)}
              placeholder="Hledat podle jména…"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-0.5">Status</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="">Všechny</option>
              <option value="planned">Naplánováno</option>
              <option value="open">Otevřené</option>
              <option value="partially_returned">Část vráceno</option>
              <option value="fully_returned">Vráceno</option>
              <option value="overdue">Po termínu</option>
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-0.5">Od</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-0.5">Do</label>
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
              Vyčistit
            </Button>
          )}
        </div>
      )}

      {list.data?.items.length === 0 && (
        <Card>
          <h2 className="font-semibold mb-1">Zatím žádné výpůjčky</h2>
          <p className="text-slate-600 text-sm mb-3">
            Výpůjčka eviduje, kdo si od tebe co odnesl. Můžeš ji založit komukoli
            (interní uživatel nebo externí jméno) a vracet pak položku po
            položce.
          </p>
          <Link to="/loans/new">
            <Button>+ Vytvořit první výpůjčku</Button>
          </Link>
        </Card>
      )}

      {list.data && list.data.items.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-slate-500">Žádné výpůjčky neodpovídají filtru.</p>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            Nadcházející rezervace
          </h2>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
            {upcoming.map((loan) => (
              <LoanRowItem key={loan.id} loan={loan} now={now} />
            ))}
          </ul>
        </div>
      )}

      {others.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
          {others.map((loan) => (
            <LoanRowItem key={loan.id} loan={loan} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LoanRowItem({ loan, now }: { loan: LoanRow; now: Date }) {
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
            {loan.items.length} ks ·{' '}
            {loan.status === 'planned'
              ? `začátek ${formatDate(loan.loanedAt)}`
              : `zapůjčeno ${formatDate(loan.startedAt ?? loan.loanedAt)}`}
            {loan.expectedReturnAt && ` · vrátit do ${formatDate(loan.expectedReturnAt)}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {overdue && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium">
              overdue
            </span>
          )}
          <span
            className={clsx('text-xs px-2 py-0.5 rounded font-medium', statusClasses[loan.status])}
          >
            {statusLabels[loan.status]}
          </span>
        </div>
      </Link>
    </li>
  );
}
