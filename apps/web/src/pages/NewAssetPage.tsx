import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Field, Input, Select } from '../components/ui.js';
import { toast } from '../components/Toast.js';
import { CustomFieldsValuesForm } from '../components/CustomFieldsValuesForm.js';
import { LocationSelect } from '../components/LocationSelect.js';
import { validateCustomFieldValues } from '@inventory-hub/shared';
import { useT } from '../i18n/index.js';

type FormValues = {
  name: string;
  typeId: string;
  locationId: string;
  code: string;
  purchasedAt: string;
  warrantyUntil: string;
  purchasePrice: string;
  supplier: string;
};

export function NewAssetPage() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState } = useForm<FormValues>({
    defaultValues: {
      name: '',
      typeId: '',
      locationId: '',
      code: '',
      purchasedAt: '',
      warrantyUntil: '',
      purchasePrice: '',
      supplier: '',
    },
  });

  const types = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => apiClient.assetTypes.list(),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });

  const typeId = watch('typeId');
  const selectedType = types.data?.items.find((type) => type.id === typeId);
  const schema = selectedType?.customFieldsSchema ?? [];

  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: async (values: FormValues) => {
      const price = values.purchasePrice.trim().replace(',', '.');
      const priceNum = price ? Number(price) : NaN;
      return apiClient.assets.create({
        name: values.name,
        code: values.code.trim() ? values.code.trim().toUpperCase() : undefined,
        typeId: values.typeId || null,
        locationId: values.locationId || null,
        customFields: customFieldValues,
        // Date inputs yield 'YYYY-MM-DD'; serialize to an ISO string (or null).
        purchasedAt: values.purchasedAt ? new Date(values.purchasedAt) : null,
        warrantyUntil: values.warrantyUntil ? new Date(values.warrantyUntil) : null,
        // User enters a decimal amount; store minor units (cents/haléře).
        purchasePrice: Number.isFinite(priceNum) ? Math.round(priceNum * 100) : null,
        supplier: values.supplier.trim() || null,
      });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['assets'] });
      toast.success(t.newAsset.created(res.code));
      navigate(`/a/${res.code}`);
    },
  });

  return (
    <section className="max-w-xl">
      <Link to="/assets" className="text-sm text-slate-500 hover:underline">
        {t.newAsset.backToList}
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-4">{t.newAsset.title}</h1>

      <form
        className="space-y-4"
        onSubmit={handleSubmit((values) => {
          const result = validateCustomFieldValues(schema, customFieldValues);
          if (!result.ok) {
            setCustomFieldErrors(result.errors);
            return;
          }
          setCustomFieldErrors({});
          create.mutate(values);
        })}
      >
        <Field label={t.newAsset.nameLabel} required error={formState.errors.name?.message}>
          <Input
            {...register('name', { required: t.newAsset.nameRequired })}
            placeholder={t.newAsset.namePlaceholder}
          />
        </Field>

        <Field label={t.newAsset.typeLabel}>
          <Select {...register('typeId')}>
            <option value="">{t.newAsset.typeNone}</option>
            {types.data?.items.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} ({type.codePrefix})
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.newAsset.locationLabel}>
          <LocationSelect locations={locations.data?.items ?? []} {...register('locationId')} />
        </Field>

        <Field label={t.newAsset.codeLabel}>
          <Input
            {...register('code')}
            placeholder={t.newAsset.codePlaceholder}
            className="font-mono"
            onChange={(e) =>
              (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))
            }
          />
        </Field>

        <div className="border-t pt-4">
          <h2 className="font-semibold mb-3 text-sm text-slate-700 dark:text-slate-200">
            {t.newAsset.lifecycleHeading}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t.newAsset.purchasedAtLabel}>
              <Input type="date" {...register('purchasedAt')} />
            </Field>
            <Field label={t.newAsset.warrantyUntilLabel}>
              <Input type="date" {...register('warrantyUntil')} />
            </Field>
            <Field label={t.newAsset.purchasePriceLabel}>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder={t.newAsset.purchasePricePlaceholder}
                {...register('purchasePrice')}
              />
            </Field>
            <Field label={t.newAsset.supplierLabel}>
              <Input placeholder={t.newAsset.supplierPlaceholder} {...register('supplier')} />
            </Field>
          </div>
        </div>

        {schema.length > 0 && (
          <div className="border-t pt-4">
            <h2 className="font-semibold mb-3 text-sm text-slate-700">
              {t.newAsset.customFields(selectedType?.name ?? '')}
            </h2>
            <CustomFieldsValuesForm
              schema={schema}
              values={customFieldValues}
              onChange={setCustomFieldValues}
              errors={customFieldErrors}
            />
          </div>
        )}

        {create.error && <p className="text-sm text-red-600">{errorMessage(create.error)}</p>}

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t.newAsset.submitting : t.newAsset.submit}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            {t.common.cancel}
          </Button>
        </div>
      </form>
    </section>
  );
}
