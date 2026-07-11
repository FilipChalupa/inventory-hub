import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { errorMessage } from '../lib/errors.js';
import { toast } from '../components/Toast.js';
import { Button, Card, Field, Input, Textarea } from '../components/ui.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { useT } from '../i18n/index.js';
import clsx from 'clsx';

type FormValues = {
  purpose: string;
  loanedAt: string;
  expectedReturnAt: string;
};

/**
 * Self-service reservation request (issue #2). Any signed-in user picks
 * available assets and a window; the request is sent to operators/admins for
 * approval. The borrower is always the requester, so there are no borrower
 * fields here.
 */
export function RequestLoanPage() {
  const t = useT();
  const navigate = useNavigate();
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const { register, handleSubmit, watch } = useForm<FormValues>({
    defaultValues: { purpose: '', loanedAt: '', expectedReturnAt: '' },
  });

  const loanedAtValue = watch('loanedAt');
  const expectedReturnValue = watch('expectedReturnAt');
  const debouncedSearch = useDebouncedValue(search);

  const assets = useQuery({
    queryKey: [
      'loan-availability',
      { q: debouncedSearch, from: loanedAtValue, to: expectedReturnValue },
    ],
    queryFn: () =>
      apiClient.loans.availability({
        q: debouncedSearch || undefined,
        from: loanedAtValue || undefined,
        to: expectedReturnValue || undefined,
      }),
  });

  const request = useMutation({
    mutationFn: (v: FormValues) =>
      apiClient.loans.request({
        purpose: v.purpose.trim() || null,
        loanedAt: v.loanedAt ? new Date(v.loanedAt) : null,
        expectedReturnAt: v.expectedReturnAt ? new Date(v.expectedReturnAt) : null,
        assetCodes: selectedCodes,
      }),
    onSuccess: (res) => {
      toast.success(t.requestLoan.requested);
      navigate(`/loans/${res.id}`);
    },
  });

  const selectedSet = useMemo(() => new Set(selectedCodes), [selectedCodes]);

  return (
    <section className="space-y-6 max-w-3xl">
      <Link to="/" className="text-sm text-slate-500 hover:underline">
        {t.requestLoan.back}
      </Link>
      <h1 className="text-2xl font-bold">{t.requestLoan.title}</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">{t.requestLoan.intro}</p>

      <form className="space-y-4" onSubmit={handleSubmit((v) => request.mutate(v))}>
        <Field label={t.requestLoan.purposeLabel}>
          <Textarea rows={2} {...register('purpose')} />
        </Field>

        <Field label={t.requestLoan.loanedAtLabel}>
          <Input type="date" {...register('loanedAt')} />
          <p className="text-xs text-slate-500 mt-1">{t.requestLoan.loanedAtHelp}</p>
        </Field>

        <Field label={t.requestLoan.expectedReturnLabel}>
          <Input type="date" {...register('expectedReturnAt')} />
        </Field>

        <Card>
          <h2 className="font-semibold mb-2">{t.requestLoan.itemsTitle}</h2>
          <p className="text-xs text-slate-500 mb-2">
            {t.requestLoan.itemsHelp(selectedCodes.length)}
          </p>
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.requestLoan.itemsSearchPlaceholder}
            className="mb-2"
          />
          <ul className="max-h-64 overflow-y-auto divide-y rounded border">
            {assets.data?.items.length === 0 && (
              <li className="p-3 text-sm text-slate-500">{t.requestLoan.noAssets}</li>
            )}
            {assets.data?.items.map((a) => {
              const checked = selectedSet.has(a.code);
              const disabled = !a.available && !checked;
              return (
                <li
                  key={a.code}
                  className={clsx(
                    'flex items-center gap-3 p-2',
                    disabled ? 'opacity-50' : 'hover:bg-slate-50 dark:hover:bg-slate-700',
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
                      {t.requestLoan.nowLent}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        {request.error && <p className="text-sm text-red-600">{errorMessage(request.error)}</p>}

        <div className="flex gap-2">
          <Button type="submit" disabled={request.isPending || selectedCodes.length === 0}>
            {request.isPending ? t.requestLoan.submitting : t.requestLoan.submit}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            {t.requestLoan.cancel}
          </Button>
        </div>
      </form>
    </section>
  );
}
