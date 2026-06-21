import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Input, Select, SkeletonList, formatDate } from '../components/ui.js';

const EVENT_LABELS: Record<string, string> = {
  created: 'Vytvořen',
  updated: 'Upraven',
  assigned: 'Přiřazen',
  unassigned: 'Odebrán z přiřazení',
  moved: 'Přesun',
  status_changed: 'Změna stavu',
  archived: 'Archivován',
  unarchived: 'Vrácen z archivu',
  damage_reported: 'Hlášené poškození',
  damage_resolved: 'Poškození opraveno',
  loan_planned: 'Rezervace vytvořena',
  loan_started: 'Vypůjčen',
  loan_item_returned: 'Vrácen z výpůjčky',
  loan_cancelled: 'Rezervace zrušena',
  loan_updated: 'Výpůjčka upravena',
  loan_item_added: 'Položka přidána do výpůjčky',
  loan_item_removed: 'Položka odebrána z výpůjčky',
  repair_started: 'Poslán do opravy',
  repair_finished: 'Oprava dokončena',
};

const PAGE = 300;

export function AuditLogPage() {
  const [limit, setLimit] = useState(PAGE);
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-log', limit],
    queryFn: () => apiClient.assets.eventsAll(limit),
    placeholderData: keepPreviousData,
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.users.list(),
    retry: false,
  });
  const [typeFilter, setTypeFilter] = useState('');
  const [q, setQ] = useState('');

  const userById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users.data?.items ?? []) m.set(u.id, u.name);
    return m;
  }, [users.data]);

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    return items.filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false;
      if (q) {
        const needle = q.toLowerCase();
        if (
          !(e.assetCode ?? '').toLowerCase().includes(needle) &&
          !(e.assetName ?? '').toLowerCase().includes(needle)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [data, typeFilter, q]);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Audit log</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Zobrazeno {data?.items.length ?? 0} z {data?.total ?? 0} událostí napříč všemi assety.
      </p>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-0.5">Asset</label>
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Kód nebo název…"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-0.5">Typ</label>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Všechny</option>
            {Object.entries(EVENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading && <SkeletonList />}
      {error && <p className="text-red-600">{errorMessage(error)}</p>}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead className="bg-slate-50 dark:bg-slate-900/40 text-left">
            <tr>
              <th className="py-2 px-3">Kdy</th>
              <th className="py-2 px-3">Typ</th>
              <th className="py-2 px-3">Asset</th>
              <th className="py-2 px-3">Kdo</th>
              <th className="py-2 px-3">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 px-3 text-slate-500 text-center">
                  Žádné události neodpovídají filtru.
                </td>
              </tr>
            )}
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="py-1.5 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {formatDate(e.occurredAt)}
                </td>
                <td className="py-1.5 px-3">
                  <span className="text-xs font-medium">
                    {EVENT_LABELS[e.type] ?? e.type}
                  </span>
                </td>
                <td className="py-1.5 px-3">
                  {e.assetCode ? (
                    <Link
                      to={`/a/${e.assetCode}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline font-mono text-xs"
                    >
                      {e.assetCode}
                    </Link>
                  ) : (
                    <span className="text-slate-400">smazán</span>
                  )}
                  {e.assetName && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {e.assetName}
                    </div>
                  )}
                </td>
                <td className="py-1.5 px-3 text-xs text-slate-600 dark:text-slate-300">
                  {e.actorUserId ? userById.get(e.actorUserId) ?? '—' : 'systém'}
                </td>
                <td className="py-1.5 px-3 text-xs text-slate-500 dark:text-slate-400 max-w-md truncate">
                  {payloadSummary(e.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>

      {data && data.items.length < data.total && (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={isLoading} onClick={() => setLimit((l) => l + PAGE)}>
            Načíst další
          </Button>
        </div>
      )}
    </section>
  );
}

function payloadSummary(payload: Record<string, unknown>): string {
  if (!payload || Object.keys(payload).length === 0) return '';
  return Object.entries(payload)
    .filter(([k]) => k !== 'code') // code is already shown in Asset column
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}
