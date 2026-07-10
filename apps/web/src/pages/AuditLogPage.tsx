import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Input, Select, SkeletonList, formatDate } from '../components/ui.js';
import { useT } from '../i18n/index.js';

const EVENT_KEYS = [
  'created',
  'updated',
  'assigned',
  'unassigned',
  'moved',
  'status_changed',
  'archived',
  'unarchived',
  'damage_reported',
  'damage_resolved',
  'loan_planned',
  'loan_started',
  'loan_item_returned',
  'loan_cancelled',
  'loan_updated',
  'loan_item_added',
  'loan_item_removed',
  'repair_started',
  'repair_finished',
];

const PAGE = 300;

export function AuditLogPage() {
  const t = useT();
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
      <h1 className="text-2xl font-bold">{t.audit.title}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t.audit.shownOf(data?.items.length ?? 0, data?.total ?? 0)}
      </p>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-0.5">
            {t.audit.asset}
          </label>
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.audit.assetPlaceholder}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-0.5">
            {t.audit.type}
          </label>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{t.audit.allTypes}</option>
            {EVENT_KEYS.map((k) => (
              <option key={k} value={k}>
                {t.audit.events[k] ?? k}
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
                <th className="py-2 px-3">{t.audit.colWhen}</th>
                <th className="py-2 px-3">{t.audit.colType}</th>
                <th className="py-2 px-3">{t.audit.colAsset}</th>
                <th className="py-2 px-3">{t.audit.colWho}</th>
                <th className="py-2 px-3">{t.audit.colDetail}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 px-3 text-slate-500 text-center">
                    {t.audit.emptyFiltered}
                  </td>
                </tr>
              )}
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td className="py-1.5 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {formatDate(e.occurredAt)}
                  </td>
                  <td className="py-1.5 px-3">
                    <span className="text-xs font-medium">{t.audit.events[e.type] ?? e.type}</span>
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
                      <span className="text-slate-400">{t.audit.assetDeleted}</span>
                    )}
                    {e.assetName && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {e.assetName}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 px-3 text-xs text-slate-600 dark:text-slate-300">
                    {e.actorUserId
                      ? (userById.get(e.actorUserId) ?? t.common.none)
                      : t.audit.system}
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
          <Button
            variant="secondary"
            disabled={isLoading}
            onClick={() => setLimit((l) => l + PAGE)}
          >
            {t.common.loadMore}
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
