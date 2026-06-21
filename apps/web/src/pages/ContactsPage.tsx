import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiClient, type ContactInput } from '../lib/api.js';
import { Button, Card, Field, Input } from '../components/ui.js';
import { confirm } from '../components/ConfirmDialog.js';
import { toast } from '../components/Toast.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { useT } from '../i18n/index.js';

export function ContactsPage() {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q);
  const list = useQuery({
    queryKey: ['contacts', dq],
    queryFn: () => apiClient.contacts.list(dq || undefined),
  });

  const { register, handleSubmit, reset, formState } = useForm<ContactInput>({
    defaultValues: { name: '', email: '', phone: '', organization: '', note: '' },
  });

  const create = useMutation({
    mutationFn: (input: ContactInput) =>
      apiClient.contacts.create({
        name: input.name.trim(),
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        organization: input.organization?.trim() || null,
        note: input.note?.trim() || null,
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
        <h1 className="text-2xl font-bold">{t.contacts.title}</h1>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">{t.contacts.intro}</p>

      <Card>
        <h2 className="font-semibold mb-2">{t.contacts.newContact}</h2>
        <form
          className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          onSubmit={handleSubmit((v) => create.mutate(v))}
        >
          <Field label={t.contacts.name} required error={formState.errors.name?.message}>
            <Input
              {...register('name', { required: t.contacts.nameRequired })}
              placeholder={t.contacts.namePlaceholder}
            />
          </Field>
          <Field label={t.contacts.organization}>
            <Input {...register('organization')} placeholder={t.contacts.organizationPlaceholder} />
          </Field>
          <Field label={t.contacts.email}>
            <Input type="email" {...register('email')} placeholder={t.contacts.emailPlaceholder} />
          </Field>
          <Field label={t.contacts.phone}>
            <Input {...register('phone')} placeholder={t.contacts.phonePlaceholder} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t.contacts.note}>
              <Input {...register('note')} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t.common.saving : t.contacts.addContact}
            </Button>
            {create.error && (
              <span className="text-sm text-red-600 ml-3">{errorMessage(create.error)}</span>
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
            placeholder={t.contacts.searchPlaceholder}
          />
        </div>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {list.data?.items.length === 0 && (
            <li className="p-4 text-slate-500">{t.contacts.empty}</li>
          )}
          {list.data?.items.map((c) => (
            <li key={c.id} className="p-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[180px]">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {[c.organization, c.email, c.phone].filter(Boolean).join(' · ') || t.common.none}
                </p>
                {c.note && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{c.note}</p>
                )}
              </div>
              <Button
                variant="ghost"
                className="text-red-600 text-xs"
                onClick={async () => {
                  if (
                    await confirm({
                      title: t.contacts.deleteTitle(c.name),
                      confirmLabel: t.common.delete,
                      danger: true,
                    })
                  ) {
                    remove.mutate(c.id, { onSuccess: () => toast.success(t.contacts.deleted) });
                  }
                }}
              >
                {t.common.delete}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
