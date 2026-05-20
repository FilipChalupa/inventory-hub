import type { CustomFieldsSchema } from '@inventory-hub/shared';
import { Field, Input, Select } from './ui.js';

type Props = {
  schema: CustomFieldsSchema;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
};

export function CustomFieldsValuesForm({ schema, values, onChange }: Props) {
  if (schema.length === 0) return null;
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-3">
      {schema.map((f) => {
        const raw = values[f.key];
        const label = f.label + (f.required ? ' *' : '');
        switch (f.type) {
          case 'text':
            return (
              <Field key={f.key} label={label}>
                <Input
                  value={(raw as string | undefined) ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </Field>
            );
          case 'number':
            return (
              <Field key={f.key} label={label}>
                <Input
                  type="number"
                  value={(raw as number | string | undefined) ?? ''}
                  onChange={(e) => set(f.key, e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
            );
          case 'date':
            return (
              <Field key={f.key} label={label}>
                <Input
                  type="date"
                  value={typeof raw === 'string' ? raw.slice(0, 10) : ''}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </Field>
            );
          case 'boolean':
            return (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(raw)}
                  onChange={(e) => set(f.key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            );
          case 'select':
            return (
              <Field key={f.key} label={label}>
                <Select
                  value={(raw as string | undefined) ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  <option value="">— vybrat —</option>
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
