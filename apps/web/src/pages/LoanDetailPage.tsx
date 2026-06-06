import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient, type LoanItemRow } from '../lib/api.js';
import { Button, Card, Field, Select, Textarea, formatDate } from '../components/ui.js';

export function LoanDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const loan = useQuery({
    queryKey: ['loan', id],
    queryFn: () => apiClient.loans.get(id),
    enabled: !!id,
  });

  if (loan.isLoading) return <p className="text-slate-500">Načítám…</p>;
  if (loan.error) return <p className="text-red-600">{(loan.error as Error).message}</p>;
  if (!loan.data) return null;

  const l = loan.data.loan;
  const planned = l.status === 'planned';
  const openCount = l.items.filter((i) => !i.returnedAt).length;
  return (
    <article className="space-y-4">
      <Link to="/loans" className="text-sm text-slate-500 hover:underline">
        ← zpět
      </Link>
      <header>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{l.borrowerName}</h1>
            {planned && (
              <span className="text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-800 font-medium">
                Naplánováno
              </span>
            )}
          </div>
          <Button
            variant="secondary"
            onClick={() => navigate(`/loans/new?from=${l.id}`)}
          >
            Založit podobnou
          </Button>
        </div>
        {l.borrowerContact && <p className="text-sm text-slate-600">{l.borrowerContact}</p>}
        {l.purpose && <p className="text-sm mt-2">Účel: {l.purpose}</p>}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm mt-2">
          <dt className="text-slate-500">{planned ? 'Plánovaný začátek' : 'Zapůjčeno'}</dt>
          <dd>{formatDate(planned ? l.loanedAt : l.startedAt ?? l.loanedAt)}</dd>
          <dt className="text-slate-500">Vrátit do</dt>
          <dd>{l.expectedReturnAt ? formatDate(l.expectedReturnAt) : '—'}</dd>
        </dl>
        {planned && (
          <StartLoanBar
            loanId={l.id}
            onStarted={() => qc.invalidateQueries({ queryKey: ['loan', id] })}
          />
        )}
      </header>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Položky</h2>
          {!planned && openCount > 0 && (
            <ReturnAllButton
              loanId={l.id}
              count={openCount}
              onDone={() => qc.invalidateQueries({ queryKey: ['loan', id] })}
            />
          )}
        </div>
        <ul className="divide-y">
          {l.items.map((item) => (
            <LoanItemRowComp
              key={item.id}
              item={item}
              loanId={l.id}
              onChanged={() => qc.invalidateQueries({ queryKey: ['loan', id] })}
            />
          ))}
        </ul>
      </Card>
    </article>
  );
}

function ReturnAllButton({
  loanId,
  count,
  onDone,
}: {
  loanId: string;
  count: number;
  onDone: () => void;
}) {
  const returnAll = useMutation({
    mutationFn: () => apiClient.loans.returnAll(loanId),
    onSuccess: onDone,
  });
  return (
    <div className="flex items-center gap-2">
      {returnAll.error && (
        <span className="text-sm text-red-600">{(returnAll.error as Error).message}</span>
      )}
      <Button
        variant="secondary"
        disabled={returnAll.isPending}
        onClick={() => {
          if (
            window.confirm(
              `Vrátit všech ${count} nevrácených položek jako v pořádku? Poškozené řeš jednotlivě.`,
            )
          ) {
            returnAll.mutate();
          }
        }}
      >
        {returnAll.isPending ? 'Vracím…' : `Vrátit vše (${count})`}
      </Button>
    </div>
  );
}

function StartLoanBar({ loanId, onStarted }: { loanId: string; onStarted: () => void }) {
  const start = useMutation({
    mutationFn: () => apiClient.loans.start(loanId),
    onSuccess: onStarted,
  });
  return (
    <div className="mt-3 flex items-center gap-3 rounded border border-violet-200 bg-violet-50 p-3">
      <p className="text-sm text-violet-900 flex-1">
        Výpůjčka je naplánovaná. Spustí se sama v termínu, nebo ji můžeš zahájit teď.
      </p>
      <Button onClick={() => start.mutate()} disabled={start.isPending}>
        {start.isPending ? 'Zahajuji…' : 'Zahájit výpůjčku'}
      </Button>
      {start.error && (
        <p className="text-sm text-red-600">{(start.error as Error).message}</p>
      )}
    </div>
  );
}

function LoanItemRowComp({
  item,
  loanId,
  onChanged,
}: {
  item: LoanItemRow;
  loanId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [condition, setCondition] = useState<'ok' | 'damaged'>('ok');
  const [notes, setNotes] = useState('');

  const mutate = useMutation({
    mutationFn: () =>
      apiClient.loans.returnItem(loanId, item.id, { returnCondition: condition, returnNotes: notes || null }),
    onSuccess: () => {
      setOpen(false);
      setNotes('');
      onChanged();
    },
  });

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link to={`/a/${item.assetCode}`} className="font-mono text-xs text-slate-500 hover:underline">
            {item.assetCode}
          </Link>
          <p>{item.assetName}</p>
        </div>
        {item.returnedAt ? (
          <span className="text-xs text-slate-500">
            vráceno {formatDate(item.returnedAt)}
            {item.returnCondition === 'damaged' && ' · poškozeno'}
          </span>
        ) : (
          <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
            Vrátit
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <Field label="Stav při vrácení">
            <Select value={condition} onChange={(e) => setCondition(e.target.value as 'ok' | 'damaged')}>
              <option value="ok">V pořádku</option>
              <option value="damaged">Poškozeno (→ vytvoří se damage report)</option>
            </Select>
          </Field>
          <Field label="Poznámka">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => mutate.mutate()} disabled={mutate.isPending}>
              {mutate.isPending ? 'Ukládám…' : 'Potvrdit vrácení'}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Zrušit
            </Button>
          </div>
          {mutate.error && (
            <p className="text-sm text-red-600">{(mutate.error as Error).message}</p>
          )}
        </div>
      )}
    </li>
  );
}
