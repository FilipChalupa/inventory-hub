import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient, type LoanEventRow, type LoanItemRow, type LoanRow } from '../lib/api.js';
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  SkeletonList,
  Textarea,
  formatDate,
} from '../components/ui.js';
import { confirm } from '../components/ConfirmDialog.js';
import { toast } from '../components/Toast.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { useT, getLocale } from '../i18n/index.js';
import { localeTag } from '../i18n/util.js';

export function LoanDetailPage() {
  const t = useT();
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

  if (loan.isLoading) return <SkeletonList rows={4} />;
  if (loan.error) return <p className="text-red-600">{errorMessage(loan.error)}</p>;
  if (!loan.data) return null;

  const l = loan.data.loan;
  const planned = l.status === 'planned';
  const requested = l.status === 'requested';
  const openCount = l.items.filter((i) => !i.returnedAt).length;
  return (
    <article className="space-y-4">
      <Link to="/loans" className="text-sm text-slate-500 hover:underline">
        ← {t.common.back}
      </Link>
      <header>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{l.borrowerName}</h1>
            {requested && (
              <span className="text-xs px-2 py-0.5 rounded bg-fuchsia-100 text-fuchsia-800 font-medium">
                {t.loanStatuses.requested}
              </span>
            )}
            {planned && (
              <span className="text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-800 font-medium">
                {t.loanStatuses.planned}
              </span>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
              {t.common.edit}
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/loans/new?from=${l.id}`)}>
              {t.loanDetail.createSimilar}
            </Button>
            {planned && (
              <Button
                variant="danger"
                disabled={cancel.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: t.loanDetail.cancelReservationTitle,
                      message: t.loanDetail.cancelReservationMessage,
                      confirmLabel: t.loanDetail.cancelReservationLabel,
                      danger: true,
                    })
                  ) {
                    cancel.mutate(undefined, {
                      onSuccess: () => toast.success(t.loanDetail.reservationCancelled),
                    });
                  }
                }}
              >
                {cancel.isPending
                  ? t.loanDetail.cancellingReservation
                  : t.loanDetail.cancelReservation}
              </Button>
            )}
          </div>
        </div>
        {cancel.error && <p className="text-sm text-red-600 mt-1">{errorMessage(cancel.error)}</p>}
        {l.borrowerContact && <p className="text-sm text-slate-600">{l.borrowerContact}</p>}
        {l.purpose && <p className="text-sm mt-2">{t.loanDetail.purpose(l.purpose)}</p>}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm mt-2">
          <dt className="text-slate-500">
            {planned ? t.loanDetail.plannedStart : t.loanDetail.loanedOut}
          </dt>
          <dd>{formatDate(planned ? l.loanedAt : (l.startedAt ?? l.loanedAt))}</dd>
          <dt className="text-slate-500">{t.loanDetail.returnBy}</dt>
          <dd>{l.expectedReturnAt ? formatDate(l.expectedReturnAt) : t.common.none}</dd>
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
          <h2 className="font-semibold">{t.loanDetail.items}</h2>
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [returnedAt, setReturnedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const returnAll = useMutation({
    mutationFn: () =>
      apiClient.loans.returnAll(loanId, returnedAt ? new Date(returnedAt) : undefined),
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
  });

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t.loanDetail.returnAll(count)}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label htmlFor="loan-return-date" className="text-xs text-slate-500">
        {t.loanDetail.returnDate}
      </label>
      <Input
        id="loan-return-date"
        type="date"
        value={returnedAt}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => setReturnedAt(e.target.value)}
        className="w-auto"
      />
      <Button onClick={() => returnAll.mutate()} disabled={returnAll.isPending}>
        {returnAll.isPending ? t.loanDetail.returningAll : t.loanDetail.returnAllAsOk(count)}
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        {t.common.cancel}
      </Button>
      {returnAll.error && (
        <p className="w-full text-right text-sm text-red-600">{errorMessage(returnAll.error)}</p>
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
  const t = useT();
  const [borrowerName, setBorrowerName] = useState(loan.borrowerName);
  const [borrowerContact, setBorrowerContact] = useState(loan.borrowerContact ?? '');
  const [purpose, setPurpose] = useState(loan.purpose ?? '');
  const [loanedAt, setLoanedAt] = useState(toDateInput(loan.loanedAt));
  const [expectedReturnAt, setExpectedReturnAt] = useState(toDateInput(loan.expectedReturnAt));

  const save = useMutation({
    mutationFn: () =>
      apiClient.loans.update(loan.id, {
        borrowerName: borrowerName.trim(),
        borrowerContact: borrowerContact.trim() || null,
        purpose: purpose.trim() || null,
        ...(planned ? { loanedAt: loanedAt ? new Date(loanedAt) : undefined } : {}),
        expectedReturnAt: expectedReturnAt ? new Date(expectedReturnAt) : null,
      }),
    onSuccess: onSaved,
  });

  return (
    <Card className="mt-3">
      <div className="space-y-3">
        <Field label={t.loanDetail.borrowerNameLabel}>
          <Input value={borrowerName} onChange={(e) => setBorrowerName(e.target.value)} />
        </Field>
        <Field label={t.loanDetail.contactLabel}>
          <Input value={borrowerContact} onChange={(e) => setBorrowerContact(e.target.value)} />
        </Field>
        <Field label={t.loanDetail.purposeLabel}>
          <Textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        {planned && (
          <Field label={t.loanDetail.loanStartLabel}>
            <Input type="date" value={loanedAt} onChange={(e) => setLoanedAt(e.target.value)} />
          </Field>
        )}
        <Field label={t.loanDetail.returnByLabel}>
          <Input
            type="date"
            value={expectedReturnAt}
            onChange={(e) => setExpectedReturnAt(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending || !borrowerName.trim()}>
            {save.isPending ? t.common.saving : t.common.save}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t.common.cancel}
          </Button>
        </div>
        {save.error && <p className="text-sm text-red-600">{errorMessage(save.error)}</p>}
      </div>
    </Card>
  );
}

function StartLoanBar({ loanId, onStarted }: { loanId: string; onStarted: () => void }) {
  const t = useT();
  const start = useMutation({
    mutationFn: () => apiClient.loans.start(loanId),
    onSuccess: onStarted,
  });
  return (
    <div className="mt-3 flex items-center gap-3 rounded border border-violet-200 bg-violet-50 p-3">
      <p className="text-sm text-violet-900 flex-1">{t.loanDetail.plannedNotice}</p>
      <Button onClick={() => start.mutate()} disabled={start.isPending}>
        {start.isPending ? t.loanDetail.starting : t.loanDetail.startLoan}
      </Button>
      {start.error && <p className="text-sm text-red-600">{errorMessage(start.error)}</p>}
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const debouncedSearch = useDebouncedValue(search);

  const avail = useQuery({
    queryKey: ['loan-availability', { loanId, q: debouncedSearch, from, to }],
    queryFn: () =>
      apiClient.loans.availability({ from, to: to ?? undefined, q: debouncedSearch || undefined }),
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
          {t.loanDetail.addItem}
        </Button>
      </div>
    );
  }

  const existing = new Set(existingCodes);
  const items = (avail.data?.items ?? []).filter((a) => !existing.has(a.code));
  const selectedSet = new Set(selected);

  return (
    <div className="mt-3 border-t pt-3 space-y-2">
      <p className="text-xs text-slate-500">{t.loanDetail.availableInTerm(selected.length)}</p>
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t.loanDetail.searchPlaceholder}
      />
      <ul className="max-h-56 overflow-y-auto divide-y rounded border">
        {items.length === 0 && (
          <li className="p-3 text-sm text-slate-500">{t.loanDetail.noAvailableAssets}</li>
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
                  {t.loanDetail.nowOnLoan}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Button onClick={() => add.mutate()} disabled={add.isPending || selected.length === 0}>
          {add.isPending ? t.loanDetail.adding : t.loanDetail.addSelected(selected.length)}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setSelected([]);
          }}
        >
          {t.common.cancel}
        </Button>
      </div>
      {add.error && <p className="text-sm text-red-600">{errorMessage(add.error)}</p>}
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
  const t = useT();
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
          <Link
            to={`/a/${item.assetCode}`}
            className="font-mono text-xs text-slate-500 hover:underline"
          >
            {item.assetCode}
          </Link>
          <p>{item.assetName}</p>
        </div>
        {item.returnedAt ? (
          <span className="text-xs text-slate-500">
            {t.loanDetail.returnedAt(formatDate(item.returnedAt))}
            {item.returnCondition === 'damaged' && t.loanDetail.damagedSuffix}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            {canRemove && (
              <Button
                variant="ghost"
                className="text-red-600 text-xs"
                disabled={remove.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: t.loanDetail.removeItemTitle(item.assetCode ?? ''),
                      confirmLabel: t.loanDetail.removeItemLabel,
                      danger: true,
                    })
                  ) {
                    remove.mutate(undefined, {
                      onSuccess: () => toast.success(t.loanDetail.itemRemoved),
                    });
                  }
                }}
              >
                {t.loanDetail.remove}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
              {t.loanDetail.return}
            </Button>
          </div>
        )}
      </div>
      {remove.error && <p className="text-sm text-red-600 mt-1">{errorMessage(remove.error)}</p>}

      {open && (
        <div className="mt-3 space-y-2">
          <Field label={t.loanDetail.returnDateLabel}>
            <Input
              type="date"
              value={returnedAt}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setReturnedAt(e.target.value)}
            />
          </Field>
          <Field label={t.loanDetail.returnConditionLabel}>
            <Select
              value={condition}
              onChange={(e) => setCondition(e.target.value as 'ok' | 'damaged')}
            >
              <option value="ok">{t.loanDetail.conditionOk}</option>
              <option value="damaged">{t.loanDetail.conditionDamaged}</option>
            </Select>
          </Field>
          <Field label={t.loanDetail.noteLabel}>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => mutate.mutate()} disabled={mutate.isPending}>
              {mutate.isPending ? t.common.saving : t.loanDetail.confirmReturn}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
          </div>
          {mutate.error && <p className="text-sm text-red-600">{errorMessage(mutate.error)}</p>}
        </div>
      )}
    </li>
  );
}

function fmtEventValue(v: unknown, none: string): string {
  if (v === null || v === undefined || v === '') return none;
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return formatDate(v);
  return String(v);
}

function LoanHistoryCard({ events }: { events: LoanEventRow[] }) {
  const t = useT();
  return (
    <Card>
      <h2 className="font-semibold mb-2">{t.loanDetail.history}</h2>
      {events.length === 0 && <p className="text-sm text-slate-500">{t.loanDetail.noHistory}</p>}
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
                  {t.loanDetail.eventLabels[e.type] ?? e.type}
                  {e.assetCode && (
                    <span className="font-mono text-xs text-slate-500"> · {e.assetCode}</span>
                  )}
                </span>
                <span className="text-xs text-slate-500">
                  {e.actorName ?? t.loanDetail.system} ·{' '}
                  {new Date(e.occurredAt).toLocaleString(localeTag(getLocale()))}
                </span>
              </div>
              {changes && (
                <ul className="mt-1 ml-3 list-inside list-disc text-xs text-slate-500">
                  {Object.entries(changes).map(([field, ch]) => (
                    <li key={field}>
                      {t.loanDetail.fieldLabels[field] ?? field}:{' '}
                      {fmtEventValue(ch.from, t.common.none)} →{' '}
                      {fmtEventValue(ch.to, t.common.none)}
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
