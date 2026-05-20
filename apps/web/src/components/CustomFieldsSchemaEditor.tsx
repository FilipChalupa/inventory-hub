import { useState } from 'react';
import type { CustomFieldDef, CustomFieldType, CustomFieldsSchema } from '@inventory-hub/shared';
import { customFieldTypes } from '@inventory-hub/shared';
import { Button, Field, Input, Select } from './ui.js';

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Číslo',
  date: 'Datum',
  boolean: 'Ano/Ne',
  select: 'Výběr ze seznamu',
};

export function CustomFieldsSchemaEditor({
  value,
  onChange,
}: {
  value: CustomFieldsSchema;
  onChange: (next: CustomFieldsSchema) => void;
}) {
  const [draft, setDraft] = useState<CustomFieldDef>({
    key: '',
    label: '',
    type: 'text',
    required: false,
    options: [],
  });

  function update(idx: number, next: CustomFieldDef) {
    onChange(value.map((f, i) => (i === idx ? next : f)));
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    if (!draft.key || !draft.label) return;
    if (value.some((f) => f.key === draft.key)) return;
    if (draft.type === 'select' && (!draft.options || draft.options.length === 0)) return;
    onChange([...value, draft]);
    setDraft({ key: '', label: '', type: 'text', required: false, options: [] });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {value.length === 0 && (
          <li className="text-xs text-slate-500">Žádné vlastní pole.</li>
        )}
        {value.map((f, idx) => (
          <li key={f.key} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_80px_auto] gap-2 items-end p-2 border rounded bg-slate-50">
            <Field label="Klíč">
              <Input value={f.key} disabled className="font-mono text-xs bg-slate-100" />
            </Field>
            <Field label="Popisek">
              <Input value={f.label} onChange={(e) => update(idx, { ...f, label: e.target.value })} />
            </Field>
            <Field label="Typ">
              <Select
                value={f.type}
                onChange={(e) => update(idx, { ...f, type: e.target.value as CustomFieldType })}
              >
                {customFieldTypes.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Povinné">
              <input
                type="checkbox"
                checked={!!f.required}
                onChange={(e) => update(idx, { ...f, required: e.target.checked })}
                className="h-9 w-9"
              />
            </Field>
            <Button variant="ghost" className="text-red-600 text-xs" onClick={() => remove(idx)}>
              Smazat
            </Button>
            {f.type === 'select' && (
              <div className="md:col-span-5">
                <Field label="Možnosti (čárkou)">
                  <Input
                    value={(f.options ?? []).join(', ')}
                    onChange={(e) =>
                      update(idx, {
                        ...f,
                        options: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </Field>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="border rounded p-3 space-y-2">
        <p className="text-xs font-medium text-slate-700">Přidat pole</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_80px_auto] gap-2 items-end">
          <Field label="Klíč (a-z, _)">
            <Input
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
              placeholder="serial_number"
              className="font-mono"
            />
          </Field>
          <Field label="Popisek">
            <Input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Sériové číslo"
            />
          </Field>
          <Field label="Typ">
            <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as CustomFieldType })}>
              {customFieldTypes.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Povinné">
            <input
              type="checkbox"
              checked={!!draft.required}
              onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
              className="h-9 w-9"
            />
          </Field>
          <Button type="button" variant="secondary" onClick={add}>
            Přidat
          </Button>
        </div>
        {draft.type === 'select' && (
          <Field label="Možnosti (čárkou)">
            <Input
              value={(draft.options ?? []).join(', ')}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  options: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="nový, použitý, rozbalený"
            />
          </Field>
        )}
      </div>
    </div>
  );
}
