import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import type { AssetStatus } from '@inventory-hub/shared';

export function AssetsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<AssetStatus | ''>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', { q, status }],
    queryFn: () =>
      apiClient.assets.list({ q: q || undefined, status: status || undefined }),
  });

  return (
    <section>
      <h1 className="text-2xl font-bold mb-4">Assety</h1>
      <div className="flex gap-2 mb-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Hledat kód nebo název…"
          className="flex-1 border rounded px-3 py-2"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as AssetStatus | '')}
          className="border rounded px-3 py-2"
        >
          <option value="">Všechny aktivní</option>
          <option value="in_stock">Skladem</option>
          <option value="assigned">Přiřazeno</option>
          <option value="on_loan">Vypůjčeno</option>
          <option value="in_repair">V opravě</option>
        </select>
      </div>

      {isLoading && <p className="text-slate-500">Načítám…</p>}
      {error && <p className="text-red-600">{(error as Error).message}</p>}

      {data && (
        <ul className="divide-y border rounded bg-white">
          {data.items.length === 0 && (
            <li className="p-4 text-slate-500">Žádné assety neodpovídají filtru.</li>
          )}
          {data.items.map((a) => (
            <li key={a.code} className="p-3 hover:bg-slate-50">
              <Link to={`/a/${a.code}`} className="flex justify-between items-center">
                <div>
                  <div className="font-mono text-sm text-slate-500">{a.code}</div>
                  <div className="font-medium">{a.name}</div>
                </div>
                <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700">
                  {a.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
