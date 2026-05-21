import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiClient, type ContactInput } from '../lib/api.js';
import { Button, Card, Field, Input } from '../components/ui.js';

export function ContactsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['contacts', q],
    queryFn: () => apiClient.contacts.list(q || undefined),
  });

  const { register, handleSubmit, reset, formState } = useForm<ContactInput>({
    defaultValues: { name: '', email: '', phone: '', organization: '', note: '' },
  });

  const create = useMutation({
    mutationFn: (input: ContactInput) =>
      apiClient.contacts.create({
        name: input.name,
        email: input.email || null,
        phone: input.phone || null,
        organization: input.organization || null,
        note: input.note || null,
      }),
    onSuccess: async () => {
      reset();
      await qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.contacts.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Kontakty</h1>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Externí osoby (subdodavatelé, partneři, zákazníci), kterým půjčuješ
        assety. Interní zaměstnance řeš přes záložku „Uživatelé".
      </p>

      <Card>
        <h2 className="font-semibold mb-2">Nový kontakt</h2>
        <form
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          onSubmit={handleSubmit((v) => create.mutate(v))}
        >
          <Field label="Jméno" error={formState.errors.name?.message}>
            <Input {...register('name', { required: 'Jméno je povinné' })} placeholder="Jan Novák" />
          </Field>
          <Field label="Organizace">
            <Input {...register('organization')} placeholder="ACME s.r.o." />
          </Field>
          <Field label="E-mail">
            <Input type="email" {...register('email')} placeholder="jan@example.com" />
          </Field>
          <Field label="Telefon">
            <Input {...register('phone')} placeholder="+420 …" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Poznámka">
              <Input {...register('note')} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Ukládám…' : 'Přidat kontakt'}
            </Button>
            {create.error && (
              <span className="text-sm text-red-600 ml-3">{(create.error as Error).message}</span>
            )}
          </div>
        </form>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-slate-200 dark:border-slate-700">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hledat podle jména nebo organizace…"
          />
        </div>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {list.data?.items.length === 0 && (
            <li className="p-4 text-slate-500">Žádné kontakty.</li>
          )}
          {list.data?.items.map((c) => (
            <li key={c.id} className="p-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[180px]">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {[c.organization, c.email, c.phone].filter(Boolean).join(' · ') || '—'}
                </p>
                {c.note && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{c.note}</p>
                )}
              </div>
              <Button
                variant="ghost"
                className="text-red-600 text-xs"
                onClick={() => {
                  if (confirm(`Smazat kontakt "${c.name}"?`)) remove.mutate(c.id);
                }}
              >
                Smazat
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
