import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Field, Input, Select } from '../components/ui.js';

type FormValues = {
  name: string;
  typeId: string;
  locationId: string;
  code: string;
};

export function NewAssetPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { register, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: { name: '', typeId: '', locationId: '', code: '' },
  });

  const types = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => apiClient.assetTypes.list(),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });

  const create = useMutation({
    mutationFn: async (values: FormValues) =>
      apiClient.assets.create({
        name: values.name,
        code: values.code.trim() ? values.code.trim().toUpperCase() : undefined,
        typeId: values.typeId || null,
        locationId: values.locationId || null,
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['assets'] });
      navigate(`/a/${res.code}`);
    },
  });

  return (
    <section className="max-w-xl">
      <Link to="/" className="text-sm text-slate-500 hover:underline">
        ← zpět na seznam
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-4">Nový asset</h1>

      <form
        className="space-y-4"
        onSubmit={handleSubmit((values) => create.mutate(values))}
      >
        <Field label="Název" error={formState.errors.name?.message}>
          <Input
            {...register('name', { required: 'Název je povinný' })}
            placeholder="ThinkPad X1 Carbon"
          />
        </Field>

        <Field label="Typ (pro auto-generování kódu)">
          <Select {...register('typeId')}>
            <option value="">— bez typu —</option>
            {types.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.codePrefix})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Lokace">
          <Select {...register('locationId')}>
            <option value="">— bez lokace —</option>
            {locations.data?.items.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Vlastní kód (nepovinné — jinak se vygeneruje z typu)">
          <Input
            {...register('code')}
            placeholder="LAP-00123"
            className="font-mono"
            onChange={(e) =>
              (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))
            }
          />
        </Field>

        {create.error && (
          <p className="text-sm text-red-600">{(create.error as Error).message}</p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Vytvářím…' : 'Vytvořit asset'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Zrušit
          </Button>
        </div>
      </form>
    </section>
  );
}
