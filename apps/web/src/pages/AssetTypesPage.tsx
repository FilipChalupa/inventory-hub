import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input } from '../components/ui.js';

export function AssetTypesPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => apiClient.assetTypes.list(),
  });

  const { register, handleSubmit, reset, formState } = useForm<{ name: string; codePrefix: string }>({
    defaultValues: { name: '', codePrefix: '' },
  });

  const create = useMutation({
    mutationFn: (v: { name: string; codePrefix: string }) =>
      apiClient.assetTypes.create({ name: v.name, codePrefix: v.codePrefix.toUpperCase() }),
    onSuccess: async () => {
      reset();
      await qc.invalidateQueries({ queryKey: ['asset-types'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.assetTypes.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-types'] }),
  });

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold">Typy assetů</h1>

      <Card>
        <h2 className="font-semibold mb-2">Nový typ</h2>
        <form
          className="flex flex-wrap gap-2 items-end"
          onSubmit={handleSubmit((v) => create.mutate(v))}
        >
          <div className="flex-1 min-w-[200px]">
            <Field label="Název">
              <Input {...register('name', { required: 'Povinné' })} placeholder="Notebook" />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Prefix" error={formState.errors.codePrefix?.message}>
              <Input
                {...register('codePrefix', {
                  required: 'Povinné',
                  pattern: { value: /^[A-Z0-9]{1,6}$/i, message: 'A–Z, 0–9, max 6 znaků' },
                })}
                placeholder="LAP"
                className="font-mono"
              />
            </Field>
          </div>
          <Button type="submit" disabled={create.isPending}>
            Přidat
          </Button>
        </form>
        {create.error && (
          <p className="text-sm text-red-600 mt-2">{(create.error as Error).message}</p>
        )}
      </Card>

      <div className="rounded border bg-white divide-y">
        {list.data?.items.length === 0 && (
          <p className="p-4 text-sm text-slate-500">Žádné typy. Přidej první výše.</p>
        )}
        {list.data?.items.map((t) => (
          <div key={t.id} className="flex items-center justify-between p-3">
            <div>
              <p className="font-medium">{t.name}</p>
              <p className="font-mono text-xs text-slate-500">{t.codePrefix}-…</p>
            </div>
            <Button
              variant="ghost"
              className="text-red-600"
              onClick={() => {
                if (confirm(`Smazat typ "${t.name}"?`)) remove.mutate(t.id);
              }}
            >
              Smazat
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
