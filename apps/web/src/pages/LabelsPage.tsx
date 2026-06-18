import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { Button, Card, Field, Input, Textarea } from '../components/ui.js';
import { hasRole, useCurrentUser } from '../auth/AuthContext.js';

export function LabelsPage() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const isAdmin = hasRole(useCurrentUser(), 'admin');
  const initial = params.get('codes')?.split(',').map((c) => c.trim()).filter(Boolean) ?? [];
  const [codesInput, setCodesInput] = useState(initial.join('\n'));
  const [filter, setFilter] = useState('');

  // Label appearance — seeded from the org-wide defaults, tweakable locally for
  // the current print, and (for admins) saveable back as the org default.
  const [compact, setCompact] = useState(false);
  const [showName, setShowName] = useState(true);
  const [note, setNote] = useState('');
  const seeded = useRef(false);

  const org = useQuery({ queryKey: ['org'], queryFn: () => apiClient.org.get() });
  useEffect(() => {
    if (seeded.current || !org.data) return;
    setCompact(org.data.labelSettings.compact);
    setShowName(org.data.labelSettings.showName);
    setNote(org.data.labelSettings.note);
    seeded.current = true;
  }, [org.data]);

  const saveDefaults = useMutation({
    mutationFn: () =>
      apiClient.org.putLabelSettings({ compact, showName, note: note.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org'] }),
  });

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
                <li key={a.code}>
                  <label className="flex items-center gap-2 p-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
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
                  </label>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card className="print:hidden space-y-3">
        <h2 className="font-semibold">Nastavení štítku</h2>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
            Malý kód (jen kód, bez odkazu)
          </label>
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            Tisknout název
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Malý kód kóduje jen kód assetu (menší QR, čte ho čtečka v aplikaci). Velký kóduje plnou
          adresu, takže ho otevře i foťák v mobilu.
        </p>
        <Field label="Poznámka pod kódem (volitelná)">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="např. Když najdete, ozvěte se: spravce@firma.cz"
            maxLength={200}
          />
        </Field>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={saveDefaults.isPending}
              onClick={() => saveDefaults.mutate()}
            >
              {saveDefaults.isPending ? 'Ukládám…' : 'Uložit jako výchozí pro organizaci'}
            </Button>
            {saveDefaults.isSuccess && (
              <span className="text-xs text-emerald-600">Uloženo pro celou organizaci.</span>
            )}
            {saveDefaults.error && (
              <span className="text-xs text-red-600">{(saveDefaults.error as Error).message}</span>
            )}
          </div>
        )}
        {!isAdmin && (
          <p className="text-xs text-slate-400">
            Výchozí nastavení pro organizaci může změnit jen admin; tady si ho můžeš upravit pro tento
            tisk.
          </p>
        )}
      </Card>

      {labels.data && (
        <div className="print:block">
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 160 : 220}px, 1fr))`,
            }}
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
                  src={apiClient.assets.qrUrl(l.code, { compact })}
                  alt={l.code}
                  className={compact ? 'w-16 h-16 shrink-0' : 'w-24 h-24 shrink-0'}
                />
                <div className="min-w-0">
                  <p className="font-mono text-xs">{l.code}</p>
                  {showName && <p className="text-sm font-medium truncate">{l.name}</p>}
                  {note.trim() && (
                    <p className="text-[10px] leading-tight text-slate-600 mt-0.5 break-words">
                      {note.trim()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
