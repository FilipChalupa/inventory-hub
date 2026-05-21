import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, formatDate } from '../components/ui.js';
import clsx from 'clsx';

const statusLabels = {
  open: 'Otevřená',
  partially_returned: 'Část vráceno',
  fully_returned: 'Vráceno',
} as const;

const statusClasses = {
  open: 'bg-amber-100 text-amber-800',
  partially_returned: 'bg-blue-100 text-blue-800',
  fully_returned: 'bg-emerald-100 text-emerald-800',
} as const;

export function LoansPage() {
  const list = useQuery({ queryKey: ['loans'], queryFn: () => apiClient.loans.list() });
  const now = new Date();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Výpůjčky</h1>
        <Link to="/loans/new">
          <Button>+ Nová výpůjčka</Button>
        </Link>
      </div>

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

      <ul className="divide-y rounded border bg-white">
        {list.data?.items.map((loan) => {
          const overdue =
            loan.status !== 'fully_returned' &&
            loan.expectedReturnAt &&
            new Date(loan.expectedReturnAt) < now;
          return (
            <li key={loan.id} className="hover:bg-slate-50">
              <Link to={`/loans/${loan.id}`} className="flex items-center justify-between p-3 gap-4">
                <div>
                  <div className="font-medium">{loan.borrowerName}</div>
                  <div className="text-xs text-slate-500">
                    {loan.items.length} ks · zapůjčeno {formatDate(loan.loanedAt)}
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
                    className={clsx(
                      'text-xs px-2 py-0.5 rounded font-medium',
                      statusClasses[loan.status],
                    )}
                  >
                    {statusLabels[loan.status]}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
