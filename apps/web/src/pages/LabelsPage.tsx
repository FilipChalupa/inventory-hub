import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { Button, Card, Input, Textarea } from '../components/ui.js';

export function LabelsPage() {
  const [params] = useSearchParams();
  const initial = params.get('codes')?.split(',').map((c) => c.trim()).filter(Boolean) ?? [];
  const [codesInput, setCodesInput] = useState(initial.join('\n'));
  const [filter, setFilter] = useState('');

  const codes = useMemo(
    () =>
      codesInput
        .split(/[\n,;\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    [codesInput],
  );

  const labels = useMutation({
    mutationFn: (cs: string[]) => apiClient.assets.labels(cs),
  });

  const all = useQuery({
    queryKey: ['assets', { all: true }],
    queryFn: () => apiClient.assets.list({}),
  });

  const filtered = useMemo(() => {
    if (!all.data) return [];
    const term = filter.trim().toLowerCase();
    if (!term) return all.data.items;
    return all.data.items.filter(
      (a) => a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term),
    );
  }, [all.data, filter]);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold print:hidden">Tisk štítků</h1>

      <div className="grid md:grid-cols-2 gap-6 print:hidden">
        <Card>
          <h2 className="font-semibold mb-2">Kódy</h2>
          <p className="text-xs text-slate-500 mb-2">
            Vlož kódy jeden na řádek (nebo oddělené čárkou), nebo vyber z assetů vpravo.
          </p>
          <Textarea
            rows={8}
            value={codesInput}
            onChange={(e) => setCodesInput(e.target.value)}
            placeholder="LAP-00001&#10;MON-00001"
            className="font-mono"
          />
          <div className="flex gap-2 mt-3">
            <Button onClick={() => labels.mutate(codes)} disabled={codes.length === 0 || labels.isPending}>
              Načíst {codes.length || ''} štítků
            </Button>
            {labels.data && (
              <Button variant="secondary" onClick={() => window.print()}>
                Tisk
              </Button>
            )}
          </div>
          {labels.error && (
            <p className="text-sm text-red-600 mt-2">{(labels.error as Error).message}</p>
          )}
        </Card>

        <Card>
          <h2 className="font-semibold mb-2">Vybrat z assetů</h2>
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtr…"
            className="mb-2"
          />
          <ul className="max-h-64 overflow-y-auto divide-y rounded border text-sm dark:divide-slate-700 dark:border-slate-700">
            {filtered.map((a) => {
              const selected = codes.includes(a.code);
              return (
                <li key={a.code} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 dark:hover:bg-slate-700">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      const next = new Set(codes);
                      if (selected) next.delete(a.code);
                      else next.add(a.code);
                      setCodesInput(Array.from(next).join('\n'));
                    }}
                  />
                  <span className="font-mono text-xs text-slate-500 w-24">{a.code}</span>
                  <span>{a.name}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {labels.data && (
        <div className="print:block">
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
          >
            {labels.data.items.map((l) => (
              <div
                key={l.code}
                // Labels are physical stickers: force black-on-white in every
                // theme + in print. Without an explicit text color the children
                // inherit the body's `dark:text-slate-100`, which prints light
                // text on the white label (unreadable).
                className="border border-slate-300 rounded p-3 flex items-center gap-3 break-inside-avoid bg-white text-slate-900"
              >
                <img
                  src={apiClient.assets.qrUrl(l.code)}
                  alt={l.code}
                  className="w-24 h-24 shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-mono text-xs">{l.code}</p>
                  <p className="text-sm font-medium truncate">{l.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
