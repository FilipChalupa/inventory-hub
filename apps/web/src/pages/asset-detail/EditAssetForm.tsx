import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { errorMessage } from '../../lib/errors.js';
import { Button, Card, Field, Input, Select } from '../../components/ui.js';
import { CustomFieldsValuesForm } from '../../components/CustomFieldsValuesForm.js';
import { LocationSelect } from '../../components/LocationSelect.js';
import type { LocationRow } from '../../lib/api.js';
import { validateCustomFieldValues, type CustomFieldsSchema } from '@inventory-hub/shared';
import { useT } from '../../i18n/index.js';

export function EditAssetForm({
  initial,
  types,
  locationsList,
  parentOptions,
  customSchema,
  onSubmit,
  onCancel,
}: {
  initial: {
    name: string;
    typeId: string;
    locationId: string;
    customFields: Record<string, unknown>;
    purchasedAt: string;
    warrantyUntil: string;
    purchasePrice: string;
    supplier: string;
    serviceIntervalDays: string;
    lastServicedAt: string;
    usefulLifeMonths: string;
    parentAssetId: string;
  };
  types: { id: string; name: string; codePrefix: string }[];
  locationsList: LocationRow[];
  parentOptions: { id: string; code: string; name: string }[];
  customSchema: CustomFieldsSchema;
  onSubmit: (v: {
    name: string;
    typeId: string;
    locationId: string;
    customFields: Record<string, unknown>;
    purchasedAt: string;
    warrantyUntil: string;
    purchasePrice: string;
    supplier: string;
    serviceIntervalDays: string;
    lastServicedAt: string;
    usefulLifeMonths: string;
    parentAssetId: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const { register, handleSubmit, formState } = useForm({ defaultValues: initial });
  const [customFieldValues, setCustomFieldValues] = useState(initial.customFields);
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (v) => {
          const cf = validateCustomFieldValues(customSchema, customFieldValues);
          if (!cf.ok) {
            setCustomFieldErrors(cf.errors);
            return;
          }
          setCustomFieldErrors({});
          setSubmitError(null);
          setSaving(true);
          try {
            await onSubmit({ ...v, customFields: customFieldValues });
          } catch (err) {
            setSubmitError(errorMessage(err));
          } finally {
            setSaving(false);
          }
        })}
      >
        <Field
          label={t.assetDetail.nameLabel}
          required
          error={formState.errors.name ? t.assetDetail.nameRequired : undefined}
        >
          <Input {...register('name', { required: true })} />
        </Field>
        <Field label={t.assetDetail.type}>
          <Select {...register('typeId')}>
            <option value="">{t.assetDetail.noType}</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.assetDetail.location}>
          <LocationSelect locations={locationsList} {...register('locationId')} />
        </Field>
        <div className="border-t pt-3">
          <h3 className="font-medium text-sm text-slate-700 dark:text-slate-200 mb-2">
            {t.assetDetail.lifecycleHeading}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t.assetDetail.purchasedAt}>
              <Input type="date" {...register('purchasedAt')} />
            </Field>
            <Field label={t.assetDetail.warrantyUntil}>
              <Input type="date" {...register('warrantyUntil')} />
            </Field>
            <Field label={t.assetDetail.purchasePrice}>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder={t.assetDetail.purchasePricePlaceholder}
                {...register('purchasePrice')}
              />
            </Field>
            <Field label={t.assetDetail.supplier}>
              <Input placeholder={t.assetDetail.supplierPlaceholder} {...register('supplier')} />
            </Field>
            <Field label={t.assetDetail.serviceIntervalLabel}>
              <Input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                placeholder={t.assetDetail.serviceIntervalPlaceholder}
                {...register('serviceIntervalDays')}
              />
            </Field>
            <Field label={t.assetDetail.lastServicedAt}>
              <Input type="date" {...register('lastServicedAt')} />
            </Field>
            <Field label={t.assetDetail.usefulLifeLabel}>
              <Input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                placeholder={t.assetDetail.usefulLifePlaceholder}
                {...register('usefulLifeMonths')}
              />
            </Field>
          </div>
        </div>
        <div className="border-t pt-3">
          <h3 className="font-medium text-sm text-slate-700 dark:text-slate-200 mb-2">
            {t.assetDetail.kitHeading}
          </h3>
          <Field label={t.assetDetail.parentAssetLabel}>
            <Select {...register('parentAssetId')}>
              <option value="">{t.assetDetail.parentAssetNone}</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} — {option.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {customSchema.length > 0 && (
          <div className="border-t pt-3">
            <h3 className="font-medium text-sm text-slate-700 mb-2">
              {t.assetDetail.customFields}
            </h3>
            <CustomFieldsValuesForm
              schema={customSchema}
              values={customFieldValues}
              onChange={setCustomFieldValues}
              errors={customFieldErrors}
            />
          </div>
        )}
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? t.common.saving : t.common.save}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t.common.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
