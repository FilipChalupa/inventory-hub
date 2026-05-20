import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import type { AssetStatus } from '@inventory-hub/shared';
import { Button, Input, Select, StatusBadge } from '../components/ui.js';

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

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Assety</h1>
        <Link to="/assets/new">
          <Button>+ Nový asset</Button>
        </Link>
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

      {data && (
        <ul className="divide-y rounded border bg-white">
          {data.items.length === 0 && (
            <li className="p-4 text-slate-500">Žádné assety neodpovídají filtru.</li>
          )}
          {data.items.map((a) => (
            <li key={a.code} className="hover:bg-slate-50">
              <Link to={`/a/${a.code}`} className="flex justify-between items-center p-3">
                <div>
                  <div className="font-mono text-xs text-slate-500">{a.code}</div>
                  <div className="font-medium">{a.name}</div>
                </div>
                <StatusBadge status={a.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
