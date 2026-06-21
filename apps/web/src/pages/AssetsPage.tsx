import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import type { AssetStatus } from '@inventory-hub/shared';
import { Button, Card, Input, Select, SkeletonList, StatusBadge } from '../components/ui.js';
import { locationPath } from '../lib/locations.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { useT } from '../i18n/index.js';

const PAGE = 100;

export function AssetsPage() {
  const t = useT();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [includeArchived, setIncludeArchived] = useState(false);
  // Server-side paging so the list isn't silently capped; "load more" grows it.
  const [limit, setLimit] = useState(PAGE);
  const dq = useDebouncedValue(q);

  // Reset paging whenever the effective query changes, so a new search starts
  // from the first page (and we don't refetch the old query at PAGE size first).
  useEffect(() => {
    setLimit(PAGE);
  }, [dq, status, includeArchived]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', { q: dq, status, includeArchived, limit }],
    queryFn: () =>
      apiClient.assets.list({
        q: dq || undefined,
        status: status || undefined,
        includeArchived,
        limit,
      }),
    placeholderData: keepPreviousData,
  });
  const total = data?.total ?? 0;
  const loadedCount = data?.items.length ?? 0;

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
        <h1 className="text-2xl font-bold">{t.assets.title}</h1>
        <div className="flex gap-2">
          <Link to="/assets/import">
            <Button variant="secondary">{t.assets.importCsv}</Button>
          </Link>
          <Link to="/assets/new">
            <Button>{t.assets.newAsset}</Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.assets.searchPlaceholder}
          className="flex-1 min-w-[200px]"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as AssetStatus | '')}
          className="w-48"
        >
          <option value="">{t.assets.allStatuses}</option>
          <option value="in_stock">{t.assetStatuses.in_stock}</option>
          <option value="assigned">{t.assetStatuses.assigned}</option>
          <option value="on_loan">{t.assetStatuses.on_loan}</option>
          <option value="in_repair">{t.assetStatuses.in_repair}</option>
          <option value="damaged">{t.assetStatuses.damaged}</option>
          <option value="sold">{t.assetStatuses.sold}</option>
          <option value="lost">{t.assetStatuses.lost}</option>
          <option value="retired">{t.assetStatuses.retired}</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          {t.assets.archived}
        </label>
      </div>

      {isLoading && <SkeletonList />}
      {error && <p className="text-red-600">{errorMessage(error)}</p>}

      {isFreshInstall && (
        <Card className="mb-4">
          <h2 className="font-semibold text-lg mb-2">{t.assets.welcomeTitle}</h2>
          <p className="text-sm text-slate-600 mb-3">{t.assets.welcomeIntro}</p>
          <ol className="space-y-2 text-sm">
            <li>
              <span className="font-medium">1.</span>{' '}
              {types.data && types.data.items.length === 0 ? (
                <>
                  <Link to="/asset-types" className="text-blue-700 hover:underline">
                    {t.assets.stepCreateType}
                  </Link>
                  {t.assets.stepCreateTypeHint}
                  <code>LAP</code>
                  {t.assets.stepCreateTypeHintEnd}
                </>
              ) : (
                <span className="text-slate-500">
                  {t.assets.stepTypeDone}
                  <Link to="/asset-types" className="text-blue-700 hover:underline">
                    {t.assets.stepTypeDoneEdit}
                  </Link>
                  {t.assets.stepTypeDoneEnd}
                </span>
              )}
            </li>
            <li>
              <span className="font-medium">2.</span>{' '}
              <Link to="/assets/new" className="text-blue-700 hover:underline">
                {t.assets.stepAddAsset}
              </Link>
              {t.assets.stepAddAssetHint}
            </li>
            <li>
              <span className="font-medium">3.</span>{' '}
              <Link to="/assets/import" className="text-blue-700 hover:underline">
                {t.assets.stepImport}
              </Link>
              {t.assets.stepImportHint}
            </li>
          </ol>
        </Card>
      )}

      {data && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
          {data.items.length === 0 && !isFreshInstall && (
            <li className="p-4 text-slate-500">{t.assets.noMatches}</li>
          )}
          {data.items.map((a) => {
            const path = a.locationId ? locationPath(locationRows, a.locationId) : '';
            return (
              <li key={a.code} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                <Link to={`/a/${a.code}`} className="flex justify-between items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-slate-500">{a.code}</div>
                    <div className="font-medium truncate">{a.name}</div>
                  </div>
                  <div className="hidden sm:block text-xs text-slate-500 max-w-[40%] truncate text-right">
                    {path || t.common.none}
                  </div>
                  <StatusBadge status={a.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-500">
          <span>{t.assets.shownOf(loadedCount, total)}</span>
          {loadedCount < total && (
            <Button
              variant="secondary"
              disabled={isLoading}
              onClick={() => setLimit((l) => l + PAGE)}
            >
              {t.common.loadMore}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
