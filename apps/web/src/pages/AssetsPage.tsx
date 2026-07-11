import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient, type BulkAssetsInput } from '../lib/api.js';
import { ASSET_STATUSES, type AssetStatus } from '@inventory-hub/shared';
import { Button, Card, Input, Select, SkeletonList, StatusBadge } from '../components/ui.js';
import { LocationSelect } from '../components/LocationSelect.js';
import { confirm } from '../components/ConfirmDialog.js';
import { toast } from '../components/Toast.js';
import { locationPath } from '../lib/locations.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { useT } from '../i18n/index.js';

const PAGE = 100;
const ARCHIVE_STATUSES = ['retired', 'sold', 'lost', 'damaged'] as const;

function parseStatus(value: string | null): AssetStatus | '' {
  return ASSET_STATUSES.includes(value as AssetStatus) ? (value as AssetStatus) : '';
}

export function AssetsPage() {
  const t = useT();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // status / typeId / locationId live in the URL so dashboard deep-links
  // (e.g. ?status=in_repair, ?typeId=…, ?locationId=…) pre-fill the filters and
  // a shared/refreshed link restores the same view.
  const status = parseStatus(searchParams.get('status'));
  const typeId = searchParams.get('typeId') ?? '';
  const locationId = searchParams.get('locationId') ?? '';

  const setFilter = (key: 'status' | 'typeId' | 'locationId', value: string) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  };

  const [q, setQ] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  // Server-side paging so the list isn't silently capped; "load more" grows it.
  const [limit, setLimit] = useState(PAGE);
  const dq = useDebouncedValue(q);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [archiveStatus, setArchiveStatus] = useState<(typeof ARCHIVE_STATUSES)[number]>('retired');

  // Reset paging (and the selection, so we never act on now-hidden rows)
  // whenever the effective query changes.
  useEffect(() => {
    setLimit(PAGE);
    setSelected(new Set());
  }, [dq, status, typeId, locationId, includeArchived]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', { q: dq, status, typeId, locationId, includeArchived, limit }],
    queryFn: () =>
      apiClient.assets.list({
        q: dq || undefined,
        status: status || undefined,
        typeId: typeId || undefined,
        locationId: locationId || undefined,
        includeArchived,
        limit,
      }),
    placeholderData: keepPreviousData,
  });
  const total = data?.total ?? 0;
  const loadedCount = data?.items.length ?? 0;
  const items = useMemo(() => data?.items ?? [], [data]);

  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });
  const locationRows = useMemo(() => locations.data?.items ?? [], [locations.data]);

  const types = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => apiClient.assetTypes.list(),
  });

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.users.list(),
    retry: false,
  });

  const bulk = useMutation({
    mutationFn: (input: BulkAssetsInput) => apiClient.assets.bulk(input),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['assets'] });
      setSelected(new Set());
      toast.success(t.assets.bulkDone(res.updated));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const selectedCodes = useMemo(() => [...selected], [selected]);
  const allSelected = items.length > 0 && items.every((a) => selected.has(a.code));

  const toggleRow = (code: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(items.map((a) => a.code)) : new Set());
  };

  const runArchive = async () => {
    if (
      await confirm({
        title: t.assets.confirmArchiveTitle,
        message: t.assets.confirmArchiveMessage,
        confirmLabel: t.assets.confirmArchiveLabel,
        danger: true,
      })
    ) {
      bulk.mutate({ action: 'archive', assetCodes: selectedCodes, status: archiveStatus });
    }
  };

  const noFilters = !q && !status && !typeId && !locationId && !includeArchived;
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
          aria-label={t.assets.searchPlaceholder}
          placeholder={t.assets.searchPlaceholder}
          className="flex-1 min-w-[200px]"
        />
        <Select
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
          className="w-44"
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
        <Select
          value={typeId}
          onChange={(e) => setFilter('typeId', e.target.value)}
          className="w-44"
        >
          <option value="">{t.assets.allTypes}</option>
          {types.data?.items.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </Select>
        <LocationSelect
          className="w-44"
          locations={locationRows}
          placeholder={t.assets.allLocations}
          value={locationId}
          onChange={(e) => setFilter('locationId', e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          {t.assets.archived}
        </label>
      </div>

      {selected.size > 0 && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t.assets.selectedCount(selected.size)}</span>
            <LocationSelect
              className="w-48"
              locations={locationRows}
              placeholder={t.assets.bulkMove}
              value=""
              disabled={bulk.isPending}
              onChange={(e) => {
                bulk.mutate({
                  action: 'move',
                  assetCodes: selectedCodes,
                  locationId: e.target.value || null,
                });
              }}
            />
            <Select
              className="w-48"
              value=""
              disabled={bulk.isPending}
              onChange={(e) => {
                if (!e.target.value) return;
                bulk.mutate({
                  action: 'assign',
                  assetCodes: selectedCodes,
                  userId: e.target.value,
                });
              }}
            >
              <option value="">{t.assets.bulkAssign}</option>
              {users.data?.items
                .filter((u) => !u.disabledAt)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
            </Select>
            <Button
              variant="secondary"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate({ action: 'unassign', assetCodes: selectedCodes })}
            >
              {t.assets.bulkUnassign}
            </Button>
            <div className="flex items-center gap-1">
              <Select
                className="w-32"
                value={archiveStatus}
                disabled={bulk.isPending}
                onChange={(e) =>
                  setArchiveStatus(e.target.value as (typeof ARCHIVE_STATUSES)[number])
                }
              >
                {ARCHIVE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t.assets.bulkArchiveStatus[s]}
                  </option>
                ))}
              </Select>
              <Button variant="danger" disabled={bulk.isPending} onClick={runArchive}>
                {t.assets.bulkArchive}
              </Button>
            </div>
            <Button variant="ghost" className="text-xs" onClick={() => setSelected(new Set())}>
              {t.assets.clearSelection}
            </Button>
          </div>
        </Card>
      )}

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
        <>
          {items.length > 0 && (
            <label className="mb-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              {t.assets.selectAll}
            </label>
          )}
          <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
            {items.length === 0 && !isFreshInstall && (
              <li className="p-4 text-slate-500">{t.assets.noMatches}</li>
            )}
            {items.map((a) => {
              const path = a.locationId ? locationPath(locationRows, a.locationId) : '';
              return (
                <li
                  key={a.code}
                  className="flex items-center hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <input
                    type="checkbox"
                    className="ml-3"
                    aria-label={t.assets.selectRow}
                    checked={selected.has(a.code)}
                    onChange={(e) => toggleRow(a.code, e.target.checked)}
                  />
                  <Link
                    to={`/a/${a.code}`}
                    className="flex flex-1 min-w-0 justify-between items-center gap-3 p-3"
                  >
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
        </>
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
