import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input } from '../components/ui.js';
import { CustomFieldsSchemaEditor } from '../components/CustomFieldsSchemaEditor.js';
import type { CustomFieldsSchema } from '@inventory-hub/shared';

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Typy assetů</h1>
        <Link
          to="/assets/import?kind=asset-types"
          className="text-sm text-blue-600 hover:underline"
        >
          Import CSV
        </Link>
      </div>

      <Card>
        <h2 className="font-semibold mb-2">Nový typ</h2>
        <form
          className="flex flex-wrap gap-2 items-end"
          onSubmit={handleSubmit((v) => create.mutate(v))}
        >
          <div className="flex-1 min-w-[200px]">
            <Field label="Název" required error={formState.errors.name?.message}>
              <Input {...register('name', { required: 'Povinné' })} placeholder="Notebook" />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Prefix" required error={formState.errors.codePrefix?.message}>
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

      <div className="space-y-3">
        {list.data?.items.length === 0 && (
          <p className="p-4 text-sm text-slate-500">Žádné typy. Přidej první výše.</p>
        )}
        {list.data?.items.map((t) => (
          <AssetTypeRow
            key={t.id}
            id={t.id}
            name={t.name}
            codePrefix={t.codePrefix}
            customFieldsSchema={t.customFieldsSchema ?? []}
            onRemove={() => {
              if (confirm(`Smazat typ "${t.name}"?`)) remove.mutate(t.id);
            }}
            onSavedSchema={() => qc.invalidateQueries({ queryKey: ['asset-types'] })}
          />
        ))}
      </div>
    </section>
  );
}

function AssetTypeRow({
  id,
  name,
  codePrefix,
  customFieldsSchema,
  onRemove,
  onSavedSchema,
}: {
  id: string;
  name: string;
  codePrefix: string;
  customFieldsSchema: CustomFieldsSchema;
  onRemove: () => void;
  onSavedSchema: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [schema, setSchema] = useState<CustomFieldsSchema>(customFieldsSchema);
  const save = useMutation({
    mutationFn: () => apiClient.assetTypes.update(id, { customFieldsSchema: schema }),
    onSuccess: () => onSavedSchema(),
  });

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{name}</p>
          <p className="font-mono text-xs text-slate-500">
            {codePrefix}-… · {customFieldsSchema.length} vlastní pole
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Skrýt' : 'Vlastní pole'}
          </Button>
          <Button variant="ghost" className="text-red-600" onClick={onRemove}>
            Smazat
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3">
          <CustomFieldsSchemaEditor value={schema} onChange={setSchema} />
          <div className="flex gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Ukládám…' : 'Uložit schéma'}
            </Button>
            <Button variant="ghost" onClick={() => setSchema(customFieldsSchema)}>
              Reset
            </Button>
          </div>
          {save.error && (
            <p className="text-xs text-red-600">{(save.error as Error).message}</p>
          )}
        </div>
      )}
    </Card>
  );
}
