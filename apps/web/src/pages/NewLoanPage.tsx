import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input, Select, Textarea } from '../components/ui.js';

type FormValues = {
  borrowerName: string;
  borrowerContact: string;
  purpose: string;
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

  const assets = useQuery({
    queryKey: ['assets', { q: search, status: 'in_stock' as const }],
    queryFn: () =>
      apiClient.assets.list({
        q: search || undefined,
        status: 'in_stock',
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

  const { register, handleSubmit, formState, setValue, watch } = useForm<FormValues>({
    defaultValues: { borrowerName: '', borrowerContact: '', purpose: '', expectedReturnAt: '' },
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
        expectedReturnAt: v.expectedReturnAt ? new Date(v.expectedReturnAt) : null,
        assetCodes: selectedCodes,
      }),
    onSuccess: (res) => navigate(`/loans/${res.id}`),
  });

  void watch; // keep watch imported even though we only use setValue here

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

        <Field label="Předpokládaný návrat">
          <Input type="date" {...register('expectedReturnAt')} />
        </Field>

        <Card>
          <h2 className="font-semibold mb-2">Položky výpůjčky</h2>
          <p className="text-xs text-slate-500 mb-2">
            Vybírej z assetů ve stavu „Skladem“. Vybráno: {selectedCodes.length}
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
              <li className="p-3 text-sm text-slate-500">Žádné dostupné assety.</li>
            )}
            {assets.data?.items.map((a) => {
              const checked = selectedSet.has(a.code);
              return (
                <li key={a.code} className="flex items-center gap-3 p-2 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelectedCodes((prev) =>
                        checked ? prev.filter((c) => c !== a.code) : [...prev, a.code],
                      )
                    }
                  />
                  <span className="font-mono text-xs text-slate-500 w-28">{a.code}</span>
                  <span>{a.name}</span>
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
