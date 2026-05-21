import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input } from '../components/ui.js';
import { LocationSelect } from '../components/LocationSelect.js';
import { locationPath, locationsAsTree } from '../lib/locations.js';

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

  const reparent = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      apiClient.locations.update(id, { parentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  });

  const tree = locationsAsTree(list.data?.items ?? []);

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
              <LocationSelect
                locations={list.data?.items ?? []}
                placeholder="— žádná (kořenová) —"
                {...register('parentId')}
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

      <Card>
        <ul className="divide-y -m-2">
          {tree.length === 0 && (
            <li className="p-3 text-sm text-slate-500">Žádné lokace.</li>
          )}
          {tree.map(({ row, depth }) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 p-2"
              style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {depth > 0 && <span className="text-slate-400 mr-1">└</span>}
                  {row.name}
                </p>
                {depth > 0 && (
                  <p className="text-xs text-slate-500">
                    {locationPath(list.data?.items ?? [], row.id)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <LocationSelect
                  locations={(list.data?.items ?? []).filter((l) => l.id !== row.id)}
                  placeholder="— přesunout pod —"
                  value={row.parentId ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === (row.parentId ?? '')) return;
                    reparent.mutate({ id: row.id, parentId: value || null });
                  }}
                  className="text-xs"
                />
                <Button
                  variant="ghost"
                  className="text-red-600 text-xs"
                  onClick={() => {
                    if (confirm(`Smazat lokaci "${row.name}"?`)) remove.mutate(row.id);
                  }}
                >
                  Smazat
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
