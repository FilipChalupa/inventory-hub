import { useState } from 'react';
import { errorMessage } from '../../lib/errors.js';
import { apiClient } from '../../lib/api.js';
import { Button, Card, Field, Input, Select } from '../../components/ui.js';
import { confirm } from '../../components/ConfirmDialog.js';
import { useT } from '../../i18n/index.js';

export function ExternalIdsCard({
  code,
  items,
  onChanged,
}: {
  code: string;
  items: { id: string; kind: string; value: string }[];
  onChanged: () => void;
}) {
  const t = useT();
  const [kind, setKind] = useState('serial');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await apiClient.assets.addExternalId(code, { kind: kind.trim(), value: value.trim() });
      setValue('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (
      !(await confirm({
        title: t.assetDetail.removeExternalIdTitle,
        confirmLabel: t.assetDetail.remove,
        danger: true,
      }))
    )
      return;
    try {
      await apiClient.assets.removeExternalId(code, id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card>
      <h2 className="font-semibold mb-2">{t.assetDetail.externalIdsHeading}</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
        {t.assetDetail.externalIdsHint}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{t.assetDetail.noExternalIds}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 mb-3">
          {items.map((eid) => (
            <li key={eid.id} className="flex items-center justify-between py-1.5 text-sm">
              <span>
                <span className="text-xs uppercase text-slate-500 dark:text-slate-400 mr-2">
                  {eid.kind}
                </span>
                <span className="font-mono">{eid.value}</span>
              </span>
              <Button
                variant="ghost"
                className="text-red-600 text-xs"
                onClick={() => remove(eid.id)}
              >
                {t.assetDetail.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2 items-end">
        <div className="w-32">
          <Field label={t.assetDetail.type}>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="serial">{t.assetDetail.kindSerial}</option>
              <option value="ean">{t.assetDetail.kindEan}</option>
              <option value="sku">{t.assetDetail.kindSku}</option>
              <option value="other">{t.assetDetail.kindOther}</option>
            </Select>
          </Field>
        </div>
        <div className="flex-1 min-w-[180px]">
          <Field label={t.assetDetail.valueLabel} required>
            <Input value={value} onChange={(e) => setValue(e.target.value)} className="font-mono" />
          </Field>
        </div>
        <Button type="submit" disabled={busy || !value.trim()}>
          {t.common.add}
        </Button>
      </form>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </Card>
  );
}
