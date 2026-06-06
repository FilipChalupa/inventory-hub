import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient, type LoanEventRow, type LoanItemRow, type LoanRow } from '../lib/api.js';
import { Button, Card, Field, Input, Select, Textarea, formatDate } from '../components/ui.js';

export function LoanDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const loan = useQuery({
    queryKey: ['loan', id],
    queryFn: () => apiClient.loans.get(id),
    enabled: !!id,
  });
  const loanEvents = useQuery({
    queryKey: ['loan-events', id],
    queryFn: () => apiClient.loans.events(id),
    enabled: !!id,
  });
  const [editing, setEditing] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['loan', id] });
    qc.invalidateQueries({ queryKey: ['loan-events', id] });
  };
  const cancel = useMutation({
    mutationFn: () => apiClient.loans.remove(id),
    onSuccess: () => navigate('/loans'),
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
              Upravit
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/loans/new?from=${l.id}`)}>
              Založit podobnou
            </Button>
            {planned && (
              <Button
                variant="danger"
                disabled={cancel.isPending}
                onClick={() => {
                  if (window.confirm('Zrušit tuto rezervaci? Akci nelze vrátit.')) {
                    cancel.mutate();
                  }
                }}
              >
                {cancel.isPending ? 'Ruším…' : 'Zrušit rezervaci'}
              </Button>
            )}
          </div>
        </div>
        {cancel.error && (
          <p className="text-sm text-red-600 mt-1">{(cancel.error as Error).message}</p>
        )}
        {l.borrowerContact && <p className="text-sm text-slate-600">{l.borrowerContact}</p>}
        {l.purpose && <p className="text-sm mt-2">Účel: {l.purpose}</p>}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm mt-2">
          <dt className="text-slate-500">{planned ? 'Plánovaný začátek' : 'Zapůjčeno'}</dt>
          <dd>{formatDate(planned ? l.loanedAt : l.startedAt ?? l.loanedAt)}</dd>
          <dt className="text-slate-500">Vrátit do</dt>
          <dd>{l.expectedReturnAt ? formatDate(l.expectedReturnAt) : '—'}</dd>
        </dl>
        {editing && (
          <EditLoanForm
            loan={l}
            planned={planned}
            onSaved={() => {
              setEditing(false);
              refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        )}
        {planned && <StartLoanBar loanId={l.id} onStarted={refresh} />}
      </header>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Položky</h2>
          {!planned && openCount > 0 && (
            <ReturnAllButton loanId={l.id} count={openCount} onDone={refresh} />
          )}
        </div>
        <ul className="divide-y">
          {l.items.map((item) => (
            <LoanItemRowComp
              key={item.id}
              item={item}
              loanId={l.id}
              canRemove={l.items.length > 1}
              onChanged={refresh}
            />
          ))}
        </ul>
        {l.status !== 'fully_returned' && (
          <AddLoanItems
            loanId={l.id}
            from={l.loanedAt}
            to={l.expectedReturnAt}
            existingCodes={l.items
              .filter((i) => !i.returnedAt)
              .map((i) => i.assetCode)
              .filter((x): x is string => Boolean(x))}
            onAdded={refresh}
          />
        )}
      </Card>

      <LoanHistoryCard events={loanEvents.data?.items ?? []} />
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
  const [open, setOpen] = useState(false);
  const [returnedAt, setReturnedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const returnAll = useMutation({
    mutationFn: () => apiClient.loans.returnAll(loanId, returnedAt ? new Date(returnedAt) : undefined),
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
  });

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Vrátit vše ({count})
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="text-xs text-slate-500">Datum vrácení</label>
      <Input
        type="date"
        value={returnedAt}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => setReturnedAt(e.target.value)}
        className="w-auto"
      />
      <Button onClick={() => returnAll.mutate()} disabled={returnAll.isPending}>
        {returnAll.isPending ? 'Vracím…' : `Vrátit vše (${count}) jako v pořádku`}
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Zrušit
      </Button>
      {returnAll.error && (
        <p className="w-full text-right text-sm text-red-600">
          {(returnAll.error as Error).message}
        </p>
      )}
    </div>
  );
}

function toDateInput(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

function EditLoanForm({
  loan,
  planned,
  onSaved,
  onCancel,
}: {
  loan: LoanRow;
  planned: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [borrowerName, setBorrowerName] = useState(loan.borrowerName);
  const [borrowerContact, setBorrowerContact] = useState(loan.borrowerContact ?? '');
  const [purpose, setPurpose] = useState(loan.purpose ?? '');
  const [loanedAt, setLoanedAt] = useState(toDateInput(loan.loanedAt));
  const [expectedReturnAt, setExpectedReturnAt] = useState(toDateInput(loan.expectedReturnAt));

  const save = useMutation({
    mutationFn: () =>
      apiClient.loans.update(loan.id, {
        borrowerName,
        borrowerContact: borrowerContact || null,
        purpose: purpose || null,
        ...(planned ? { loanedAt: loanedAt ? new Date(loanedAt) : undefined } : {}),
        expectedReturnAt: expectedReturnAt ? new Date(expectedReturnAt) : null,
      }),
    onSuccess: onSaved,
  });

  return (
    <Card className="mt-3">
      <div className="space-y-3">
        <Field label="Jméno vypůjčujícího">
          <Input value={borrowerName} onChange={(e) => setBorrowerName(e.target.value)} />
        </Field>
        <Field label="Kontakt (e-mail / telefon)">
          <Input value={borrowerContact} onChange={(e) => setBorrowerContact(e.target.value)} />
        </Field>
        <Field label="Účel">
          <Textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        {planned && (
          <Field label="Začátek výpůjčky">
            <Input type="date" value={loanedAt} onChange={(e) => setLoanedAt(e.target.value)} />
          </Field>
        )}
        <Field label="Vrátit do">
          <Input
            type="date"
            value={expectedReturnAt}
            onChange={(e) => setExpectedReturnAt(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending || !borrowerName.trim()}>
            {save.isPending ? 'Ukládám…' : 'Uložit'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Zrušit
          </Button>
        </div>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
      </div>
    </Card>
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

function AddLoanItems({
  loanId,
  from,
  to,
  existingCodes,
  onAdded,
}: {
  loanId: string;
  from: string;
  to: string | null;
  existingCodes: string[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const avail = useQuery({
    queryKey: ['loan-availability', { loanId, q: search, from, to }],
    queryFn: () =>
      apiClient.loans.availability({ from, to: to ?? undefined, q: search || undefined }),
    enabled: open,
  });

  const add = useMutation({
    mutationFn: () => apiClient.loans.addItems(loanId, selected),
    onSuccess: () => {
      setSelected([]);
      setOpen(false);
      onAdded();
    },
  });

  if (!open) {
    return (
      <div className="mt-3">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          + Přidat položku
        </Button>
      </div>
    );
  }

  const existing = new Set(existingCodes);
  const items = (avail.data?.items ?? []).filter((a) => !existing.has(a.code));
  const selectedSet = new Set(selected);

  return (
    <div className="mt-3 border-t pt-3 space-y-2">
      <p className="text-xs text-slate-500">
        Assety volné v termínu výpůjčky. Vybráno: {selected.length}
      </p>
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Hledat kód / název…"
      />
      <ul className="max-h-56 overflow-y-auto divide-y rounded border">
        {items.length === 0 && (
          <li className="p-3 text-sm text-slate-500">Žádné dostupné assety.</li>
        )}
        {items.map((a) => {
          const checked = selectedSet.has(a.code);
          const disabled = !a.available && !checked;
          return (
            <li
              key={a.code}
              className={`flex items-center gap-3 p-2 ${disabled ? 'opacity-50' : 'hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() =>
                  setSelected((prev) =>
                    checked ? prev.filter((c) => c !== a.code) : [...prev, a.code],
                  )
                }
              />
              <span className="font-mono text-xs text-slate-500 w-28">{a.code}</span>
              <span className="flex-1">{a.name}</span>
              {!a.available && a.reason && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                  {a.reason}
                </span>
              )}
              {a.available && a.status === 'on_loan' && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                  teď půjčeno
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Button onClick={() => add.mutate()} disabled={add.isPending || selected.length === 0}>
          {add.isPending ? 'Přidávám…' : `Přidat (${selected.length})`}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setSelected([]);
          }}
        >
          Zrušit
        </Button>
      </div>
      {add.error && <p className="text-sm text-red-600">{(add.error as Error).message}</p>}
    </div>
  );
}

function LoanItemRowComp({
  item,
  loanId,
  canRemove,
  onChanged,
}: {
  item: LoanItemRow;
  loanId: string;
  canRemove: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [condition, setCondition] = useState<'ok' | 'damaged'>('ok');
  const [notes, setNotes] = useState('');
  const [returnedAt, setReturnedAt] = useState(() => new Date().toISOString().slice(0, 10));

  const remove = useMutation({
    mutationFn: () => apiClient.loans.removeItem(loanId, item.id),
    onSuccess: onChanged,
  });

  const mutate = useMutation({
    mutationFn: () =>
      apiClient.loans.returnItem(loanId, item.id, {
        returnCondition: condition,
        returnNotes: notes || null,
        returnedAt: returnedAt ? new Date(returnedAt) : undefined,
      }),
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
          <div className="flex items-center gap-2">
            {canRemove && (
              <Button
                variant="ghost"
                className="text-red-600 text-xs"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Odebrat ${item.assetCode} z výpůjčky?`)) remove.mutate();
                }}
              >
                Odebrat
              </Button>
            )}
            <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
              Vrátit
            </Button>
          </div>
        )}
      </div>
      {remove.error && (
        <p className="text-sm text-red-600 mt-1">{(remove.error as Error).message}</p>
      )}

      {open && (
        <div className="mt-3 space-y-2">
          <Field label="Datum vrácení">
            <Input
              type="date"
              value={returnedAt}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setReturnedAt(e.target.value)}
            />
          </Field>
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

const LOAN_EVENT_LABELS: Record<string, string> = {
  loan_planned: 'Rezervace vytvořena',
  loan_started: 'Zahájeno / vypůjčeno',
  loan_item_returned: 'Položka vrácena',
  loan_item_added: 'Položka přidána',
  loan_item_removed: 'Položka odebrána',
  loan_updated: 'Upraveno',
  loan_cancelled: 'Rezervace zrušena',
  damage_reported: 'Nahlášeno poškození',
};

const LOAN_FIELD_LABELS: Record<string, string> = {
  borrowerName: 'Jméno',
  borrowerContact: 'Kontakt',
  borrowerContactId: 'Kontakt (vazba)',
  purpose: 'Účel',
  loanedAt: 'Začátek',
  expectedReturnAt: 'Návrat',
};

function fmtEventValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return formatDate(v);
  return String(v);
}

function LoanHistoryCard({ events }: { events: LoanEventRow[] }) {
  return (
    <Card>
      <h2 className="font-semibold mb-2">Historie</h2>
      {events.length === 0 && <p className="text-sm text-slate-500">Zatím žádné záznamy.</p>}
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {events.map((e) => {
          const changes =
            e.type === 'loan_updated'
              ? (e.payload?.changes as Record<string, { from: unknown; to: unknown }> | undefined)
              : undefined;
          return (
            <li key={e.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {LOAN_EVENT_LABELS[e.type] ?? e.type}
                  {e.assetCode && (
                    <span className="font-mono text-xs text-slate-500"> · {e.assetCode}</span>
                  )}
                </span>
                <span className="text-xs text-slate-500">
                  {e.actorName ?? 'systém'} · {new Date(e.occurredAt).toLocaleString('cs-CZ')}
                </span>
              </div>
              {changes && (
                <ul className="mt-1 ml-3 list-inside list-disc text-xs text-slate-500">
                  {Object.entries(changes).map(([field, ch]) => (
                    <li key={field}>
                      {LOAN_FIELD_LABELS[field] ?? field}: {fmtEventValue(ch.from)} →{' '}
                      {fmtEventValue(ch.to)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
