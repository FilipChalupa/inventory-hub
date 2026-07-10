import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input } from '../components/ui.js';
import { confirm } from '../components/ConfirmDialog.js';
import { toast } from '../components/Toast.js';
import { CustomFieldsSchemaEditor } from '../components/CustomFieldsSchemaEditor.js';
import type { CustomFieldsSchema } from '@inventory-hub/shared';
import { useT } from '../i18n/index.js';

export function AssetTypesPage() {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => apiClient.assetTypes.list(),
  });

  const { register, handleSubmit, reset, formState } = useForm<{
    name: string;
    codePrefix: string;
  }>({
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
        <h1 className="text-2xl font-bold">{t.assetTypes.title}</h1>
        <Link
          to="/assets/import?kind=asset-types"
          className="text-sm text-blue-600 hover:underline"
        >
          {t.assetTypes.importCsv}
        </Link>
      </div>

      <Card>
        <h2 className="font-semibold mb-2">{t.assetTypes.newType}</h2>
        <form
          className="flex flex-wrap gap-2 items-end"
          onSubmit={handleSubmit((v) => create.mutate(v))}
        >
          <div className="flex-1 min-w-[200px]">
            <Field label={t.assetTypes.name} required error={formState.errors.name?.message}>
              <Input
                {...register('name', { required: t.common.required })}
                placeholder={t.assetTypes.namePlaceholder}
              />
            </Field>
          </div>
          <div className="w-32">
            <Field
              label={t.assetTypes.prefix}
              required
              error={formState.errors.codePrefix?.message}
            >
              <Input
                {...register('codePrefix', {
                  required: t.common.required,
                  pattern: { value: /^[A-Z0-9]{1,6}$/i, message: t.assetTypes.prefixPattern },
                })}
                placeholder={t.assetTypes.prefixPlaceholder}
                className="font-mono"
              />
            </Field>
          </div>
          <Button type="submit" disabled={create.isPending}>
            {t.common.add}
          </Button>
        </form>
        {create.error && <p className="text-sm text-red-600 mt-2">{errorMessage(create.error)}</p>}
      </Card>

      <div className="space-y-3">
        {list.data?.items.length === 0 && (
          <p className="p-4 text-sm text-slate-500">{t.assetTypes.emptyList}</p>
        )}
        {list.data?.items.map((type) => (
          <AssetTypeRow
            key={type.id}
            id={type.id}
            name={type.name}
            codePrefix={type.codePrefix}
            customFieldsSchema={type.customFieldsSchema ?? []}
            onRemove={async () => {
              if (
                await confirm({
                  title: t.assetTypes.confirmDeleteTitle(type.name),
                  confirmLabel: t.common.delete,
                  danger: true,
                })
              ) {
                remove.mutate(type.id, {
                  onSuccess: () => toast.success(t.assetTypes.typeDeleted),
                });
              }
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
  const t = useT();
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
            {codePrefix}-… · {t.assetTypes.customFieldsCount(customFieldsSchema.length)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t.assetTypes.hide : t.assetTypes.customFields}
          </Button>
          <Button variant="ghost" className="text-red-600" onClick={onRemove}>
            {t.common.delete}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3">
          <CustomFieldsSchemaEditor value={schema} onChange={setSchema} />
          <div className="flex gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? t.common.saving : t.assetTypes.saveSchema}
            </Button>
            <Button variant="ghost" onClick={() => setSchema(customFieldsSchema)}>
              {t.assetTypes.reset}
            </Button>
          </div>
          {save.error && <p className="text-xs text-red-600">{errorMessage(save.error)}</p>}
        </div>
      )}
    </Card>
  );
}
