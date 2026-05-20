import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../lib/api.js';

export function AssetDetailPage() {
  const { code = '' } = useParams<{ code: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['asset', code],
    queryFn: () => apiClient.assets.get(code),
    enabled: !!code,
  });

  if (isLoading) return <p className="text-slate-500">Načítám…</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!data) return null;

  const a = data.asset;
  return (
    <article>
      <Link to="/" className="text-sm text-slate-500 hover:underline">
        ← zpět na seznam
      </Link>
      <h1 className="text-2xl font-bold mt-2">{a.name}</h1>
      <p className="font-mono text-slate-500">{a.code}</p>

      <dl className="mt-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-500">Stav</dt>
        <dd>{a.status}</dd>
        <dt className="text-slate-500">Archivováno</dt>
        <dd>{a.archivedAt ? new Date(a.archivedAt).toLocaleString('cs-CZ') : '—'}</dd>
        <dt className="text-slate-500">Vytvořeno</dt>
        <dd>{new Date(a.createdAt).toLocaleString('cs-CZ')}</dd>
      </dl>
    </article>
  );
}
