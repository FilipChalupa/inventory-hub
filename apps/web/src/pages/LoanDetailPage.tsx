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
  return (
    <article className="space-y-4">
      <Link to="/loans" className="text-sm text-slate-500 hover:underline">
        ← zpět
      </Link>
      <header>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold">{l.borrowerName}</h1>
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
          <dt className="text-slate-500">Zapůjčeno</dt>
          <dd>{formatDate(l.loanedAt)}</dd>
          <dt className="text-slate-500">Vrátit do</dt>
          <dd>{l.expectedReturnAt ? formatDate(l.expectedReturnAt) : '—'}</dd>
        </dl>
      </header>

      <Card>
        <h2 className="font-semibold mb-2">Položky</h2>
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
