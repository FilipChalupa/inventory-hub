import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input, Select } from '../components/ui.js';

export function LocationsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });

  const { register, handleSubmit, reset } = useForm<{ name: string; parentId: string }>({
    defaultValues: { name: '', parentId: '' },
  });

  const create = useMutation({
    mutationFn: (v: { name: string; parentId: string }) =>
      apiClient.locations.create({ name: v.name, parentId: v.parentId || null }),
    onSuccess: async () => {
      reset();
      await qc.invalidateQueries({ queryKey: ['locations'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.locations.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  });

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold">Lokace</h1>

      <Card>
        <h2 className="font-semibold mb-2">Nová lokace</h2>
        <form
          className="flex flex-wrap gap-2 items-end"
          onSubmit={handleSubmit((v) => create.mutate(v))}
        >
          <div className="flex-1 min-w-[200px]">
            <Field label="Název">
              <Input {...register('name', { required: true })} placeholder="Kancelář 4.NP" />
            </Field>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Field label="Nadřazená">
              <Select {...register('parentId')}>
                <option value="">— žádná —</option>
                {list.data?.items.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={create.isPending}>
            Přidat
          </Button>
        </form>
      </Card>

      <div className="rounded border bg-white divide-y">
        {list.data?.items.length === 0 && (
          <p className="p-4 text-sm text-slate-500">Žádné lokace.</p>
        )}
        {list.data?.items.map((l) => (
          <div key={l.id} className="flex items-center justify-between p-3">
            <p className="font-medium">{l.name}</p>
            <Button
              variant="ghost"
              className="text-red-600"
              onClick={() => {
                if (confirm(`Smazat lokaci "${l.name}"?`)) remove.mutate(l.id);
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
