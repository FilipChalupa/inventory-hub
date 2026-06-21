import type { CustomFieldsSchema } from '@inventory-hub/shared';
import { Field, Input, Select } from './ui.js';
import { useT } from '../i18n/index.js';

type Props = {
  schema: CustomFieldsSchema;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Per-field validation messages keyed by field key (see validateCustomFieldValues). */
  errors?: Record<string, string>;
};

export function CustomFieldsValuesForm({ schema, values, onChange, errors }: Props) {
  const t = useT();
  if (schema.length === 0) return null;
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-3">
      {schema.map((f) => {
        const raw = values[f.key];
        const error = errors?.[f.key];
        switch (f.type) {
          case 'text':
            return (
              <Field key={f.key} label={f.label} required={f.required} error={error}>
                <Input
                  value={(raw as string | undefined) ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </Field>
            );
          case 'number':
            return (
              <Field key={f.key} label={f.label} required={f.required} error={error}>
                <Input
                  type="number"
                  value={(raw as number | string | undefined) ?? ''}
                  onChange={(e) => set(f.key, e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
            );
          case 'date':
            return (
              <Field key={f.key} label={f.label} required={f.required} error={error}>
                <Input
                  type="date"
                  value={typeof raw === 'string' ? raw.slice(0, 10) : ''}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </Field>
            );
          case 'boolean':
            return (
              <div key={f.key}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(raw)}
                    onChange={(e) => set(f.key, e.target.checked)}
                  />
                  <span>
                    {f.label}
                    {f.required && <span className="text-red-600"> *</span>}
                  </span>
                </label>
                {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
              </div>
            );
          case 'select':
            return (
              <Field key={f.key} label={f.label} required={f.required} error={error}>
                <Select
                  value={(raw as string | undefined) ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  <option value="">{t.components.selectPlaceholder}</option>
                  {(f.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </Select>
              </Field>
            );
        }
      })}
    </div>
  );
}
