import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import type { AssetStatus } from '@inventory-hub/shared';
import { Button, Card, Input, Select, StatusBadge } from '../components/ui.js';
import { locationPath } from '../lib/locations.js';

export function AssetsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', { q, status, includeArchived }],
    queryFn: () =>
      apiClient.assets.list({
        q: q || undefined,
        status: status || undefined,
        includeArchived,
      }),
  });

  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });
  const locationRows = useMemo(() => locations.data?.items ?? [], [locations.data]);

  const types = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => apiClient.assetTypes.list(),
  });

  const noFilters = !q && !status && !includeArchived;
  const isFreshInstall = data && data.items.length === 0 && noFilters;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Assety</h1>
        <div className="flex gap-2">
          <Link to="/assets/import">
            <Button variant="secondary">Import CSV</Button>
          </Link>
          <Link to="/assets/new">
            <Button>+ Nový asset</Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Hledat kód nebo název…"
          className="flex-1 min-w-[200px]"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as AssetStatus | '')}
          className="w-48"
        >
          <option value="">Všechny stavy</option>
          <option value="in_stock">Skladem</option>
          <option value="assigned">Přiřazeno</option>
          <option value="on_loan">Vypůjčeno</option>
          <option value="in_repair">V opravě</option>
          <option value="damaged">Poškozeno</option>
          <option value="sold">Prodáno</option>
          <option value="lost">Ztraceno</option>
          <option value="retired">Vyřazeno</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          archivované
        </label>
      </div>

      {isLoading && <p className="text-slate-500">Načítám…</p>}
      {error && <p className="text-red-600">{(error as Error).message}</p>}

      {isFreshInstall && (
        <Card className="mb-4">
          <h2 className="font-semibold text-lg mb-2">Vítej v Inventory Hub 👋</h2>
          <p className="text-sm text-slate-600 mb-3">
            Tady budou tvoje assety. Začni jedním ze tří kroků:
          </p>
          <ol className="space-y-2 text-sm">
            <li>
              <span className="font-medium">1.</span>{' '}
              {types.data && types.data.items.length === 0 ? (
                <>
                  <Link to="/asset-types" className="text-blue-700 hover:underline">
                    Vytvoř typ assetu
                  </Link>{' '}
                  — definuje prefix kódu (např. <code>LAP</code>) a volitelná vlastní pole.
                </>
              ) : (
                <span className="text-slate-500">
                  ✓ Typ assetu už máš (
                  <Link to="/asset-types" className="text-blue-700 hover:underline">
                    upravit
                  </Link>
                  ).
                </span>
              )}
            </li>
            <li>
              <span className="font-medium">2.</span>{' '}
              <Link to="/assets/new" className="text-blue-700 hover:underline">
                Přidej první asset
              </Link>{' '}
              ručně, nebo
            </li>
            <li>
              <span className="font-medium">3.</span>{' '}
              <Link to="/assets/import" className="text-blue-700 hover:underline">
                naimportuj z CSV
              </Link>{' '}
              — vhodné pro hromadnou inicializaci.
            </li>
          </ol>
        </Card>
      )}

      {data && (
        <ul className="divide-y rounded border bg-white">
          {data.items.length === 0 && !isFreshInstall && (
            <li className="p-4 text-slate-500">Žádné assety neodpovídají filtru.</li>
          )}
          {data.items.map((a) => {
            const path = a.locationId ? locationPath(locationRows, a.locationId) : '';
            return (
              <li key={a.code} className="hover:bg-slate-50">
                <Link to={`/a/${a.code}`} className="flex justify-between items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-slate-500">{a.code}</div>
                    <div className="font-medium truncate">{a.name}</div>
                  </div>
                  <div className="hidden sm:block text-xs text-slate-500 max-w-[40%] truncate text-right">
                    {path || '—'}
                  </div>
                  <StatusBadge status={a.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
