import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input, Select, Textarea } from '../components/ui.js';
import clsx from 'clsx';

type FormValues = {
  borrowerName: string;
  borrowerContact: string;
  purpose: string;
  loanedAt: string;
  expectedReturnAt: string;
};

export function NewLoanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromLoanId = searchParams.get('from');
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [contactId, setContactId] = useState<string>('');
  const [prefilled, setPrefilled] = useState(false);

  const { register, handleSubmit, formState, setValue, watch } = useForm<FormValues>({
    defaultValues: {
      borrowerName: '',
      borrowerContact: '',
      purpose: '',
      loanedAt: '',
      expectedReturnAt: '',
    },
  });

  // The available assets depend on the chosen loan window: a currently
  // borrowed item is offered when it is free again within [from, to).
  const loanedAtValue = watch('loanedAt');
  const expectedReturnValue = watch('expectedReturnAt');

  const assets = useQuery({
    queryKey: ['loan-availability', { q: search, from: loanedAtValue, to: expectedReturnValue }],
    queryFn: () =>
      apiClient.loans.availability({
        q: search || undefined,
        from: loanedAtValue || undefined,
        to: expectedReturnValue || undefined,
      }),
  });

  const contacts = useQuery({
    queryKey: ['contacts'],
    queryFn: () => apiClient.contacts.list(),
  });

  // When "?from=<loanId>" is present we clone an existing loan: borrower,
  // contact and purpose are copied so a frequently repeating loan can be
  // recreated in a couple of clicks. The return date is intentionally left
  // blank (the old one is in the past) and the same items are pre-selected
  // when they are available again.
  const sourceLoan = useQuery({
    queryKey: ['loan', fromLoanId],
    queryFn: () => apiClient.loans.get(fromLoanId as string),
    enabled: !!fromLoanId,
  });

  useEffect(() => {
    if (prefilled || !fromLoanId) return;
    const l = sourceLoan.data?.loan;
    if (!l) return;
    setValue('borrowerName', l.borrowerName);
    setValue('borrowerContact', l.borrowerContact ?? '');
    setValue('purpose', l.purpose ?? '');
    if (l.borrowerContactId) setContactId(l.borrowerContactId);
    const codes = l.items.map((i) => i.assetCode).filter((c): c is string => Boolean(c));
    if (codes.length) setSelectedCodes(codes);
    setPrefilled(true);
  }, [fromLoanId, sourceLoan.data, prefilled, setValue]);

  // When the user picks a contact, autofill the name + contact fields so
  // the loan still has a free-text snapshot of the borrower's name in
  // case the contact is later renamed or deleted.
  useEffect(() => {
    if (!contactId) return;
    const c = contacts.data?.items.find((x) => x.id === contactId);
    if (!c) return;
    setValue('borrowerName', c.name);
    setValue('borrowerContact', c.email || c.phone || '');
  }, [contactId, contacts.data, setValue]);

  const create = useMutation({
    mutationFn: (v: FormValues) =>
      apiClient.loans.create({
        borrowerName: v.borrowerName,
        borrowerContactId: contactId || null,
        borrowerContact: v.borrowerContact || null,
        purpose: v.purpose || null,
        loanedAt: v.loanedAt ? new Date(v.loanedAt) : null,
        expectedReturnAt: v.expectedReturnAt ? new Date(v.expectedReturnAt) : null,
        assetCodes: selectedCodes,
      }),
    onSuccess: (res) => navigate(`/loans/${res.id}`),
  });

  const selectedSet = useMemo(() => new Set(selectedCodes), [selectedCodes]);

  return (
    <section className="space-y-6 max-w-3xl">
      <Link to="/loans" className="text-sm text-slate-500 hover:underline">
        ← zpět na výpůjčky
      </Link>
      <h1 className="text-2xl font-bold">
        {fromLoanId ? 'Nová podobná výpůjčka' : 'Nová výpůjčka'}
      </h1>

      {fromLoanId && prefilled && (
        <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          Předvyplněno podle dřívější výpůjčky. Zkontroluj položky – předvybrané assety se zobrazí
          jen pokud jsou znovu skladem.
        </p>
      )}

      <form className="space-y-4" onSubmit={handleSubmit((v) => create.mutate(v))}>
        <Field label="Vybrat existující kontakt (volitelné)">
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">— bez kontaktu, ručně níže —</option>
            {contacts.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.organization ? ` · ${c.organization}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Jméno vypůjčujícího" error={formState.errors.borrowerName?.message}>
          <Input
            {...register('borrowerName', { required: 'Jméno je povinné' })}
            placeholder="Jan Novák"
          />
        </Field>

        <Field label="Kontakt (e-mail / telefon)">
          <Input {...register('borrowerContact')} placeholder="jan@example.com" />
        </Field>

        <Field label="Účel (volitelné)">
          <Textarea rows={2} {...register('purpose')} />
        </Field>

        <Field label="Začátek výpůjčky (volitelné)">
          <Input type="date" {...register('loanedAt')} />
          <p className="text-xs text-slate-500 mt-1">
            Necháš-li prázdné, výpůjčka začne hned. Budoucí datum ji naplánuje – assety se
            rezervují a vypůjčí se až v termínu (nebo ručně).
          </p>
        </Field>

        <Field label="Předpokládaný návrat">
          <Input type="date" {...register('expectedReturnAt')} />
        </Field>

        <Card>
          <h2 className="font-semibold mb-2">Položky výpůjčky</h2>
          <p className="text-xs text-slate-500 mb-2">
            Vybrat lze assety volné ve zvoleném termínu – včetně právě půjčených, které se do
            začátku stihnou vrátit. Nedostupné jsou zašedlé i s důvodem. Vybráno:{' '}
            {selectedCodes.length}
          </p>
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Hledat kód / název…"
            className="mb-2"
          />
          <ul className="max-h-64 overflow-y-auto divide-y rounded border">
            {assets.data?.items.length === 0 && (
              <li className="p-3 text-sm text-slate-500">Žádné assety neodpovídají hledání.</li>
            )}
            {assets.data?.items.map((a) => {
              const checked = selectedSet.has(a.code);
              // Disable only unavailable assets that aren't already picked,
              // so a selection can still be undone if the window changes.
              const disabled = !a.available && !checked;
              return (
                <li
                  key={a.code}
                  className={clsx(
                    'flex items-center gap-3 p-2',
                    disabled ? 'opacity-50' : 'hover:bg-slate-50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() =>
                      setSelectedCodes((prev) =>
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
        </Card>

        {create.error && (
          <p className="text-sm text-red-600">{(create.error as Error).message}</p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending || selectedCodes.length === 0}>
            {create.isPending ? 'Ukládám…' : 'Vytvořit výpůjčku'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Zrušit
          </Button>
        </div>
      </form>
    </section>
  );
}
