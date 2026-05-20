import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input, Textarea } from '../components/ui.js';

type FormValues = {
  borrowerName: string;
  borrowerContact: string;
  purpose: string;
  expectedReturnAt: string;
};

export function NewLoanPage() {
  const navigate = useNavigate();
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const assets = useQuery({
    queryKey: ['assets', { q: search, status: 'in_stock' as const }],
    queryFn: () =>
      apiClient.assets.list({
        q: search || undefined,
        status: 'in_stock',
      }),
  });

  const { register, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { borrowerName: '', borrowerContact: '', purpose: '', expectedReturnAt: '' },
  });

  const create = useMutation({
    mutationFn: (v: FormValues) =>
      apiClient.loans.create({
        borrowerName: v.borrowerName,
        borrowerContact: v.borrowerContact || null,
        purpose: v.purpose || null,
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
      <h1 className="text-2xl font-bold">Nová výpůjčka</h1>

      <form className="space-y-4" onSubmit={handleSubmit((v) => create.mutate(v))}>
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
