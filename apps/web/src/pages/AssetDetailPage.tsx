import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card, Select, StatusBadge, formatDate, formatDateOnly } from '../components/ui.js';
import { confirm } from '../components/ConfirmDialog.js';
import { AvailabilityCalendar } from '../components/AvailabilityCalendar.js';
import { nextFreeAt, nonLoanableReason, toISODate, type BusyWindow } from '../lib/availability.js';
import { locationPath } from '../lib/locations.js';
import {
  currentAssetValue,
  nextServiceDue,
  type CustomFieldsSchema,
  type DamageSeverity,
} from '@inventory-hub/shared';
import { toast } from '../components/Toast.js';
import { useT, getLocale } from '../i18n/index.js';
import { localeTag } from '../i18n/util.js';
import { AssetDetailSkeleton } from './asset-detail/AssetDetailSkeleton.js';
import { AssetDocumentsCard } from './asset-detail/AssetDocumentsCard.js';
import { AssetPhotosCard } from './asset-detail/AssetPhotosCard.js';
import { ExternalIdsCard } from './asset-detail/ExternalIdsCard.js';
import { EditAssetForm } from './asset-detail/EditAssetForm.js';
import { NewDamageForm } from './asset-detail/NewDamageForm.js';
import {
  FragmentRow,
  formatCustomFieldValue,
  formatPrice,
  serviceStatus,
  toDateInput,
  warrantyStatus,
} from './asset-detail/helpers.js';

export function AssetDetailPage() {
  const t = useT();
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const asset = useQuery({
    queryKey: ['asset', code],
    queryFn: () => apiClient.assets.get(code),
    enabled: !!code,
  });
  const damages = useQuery({
    queryKey: ['damages', code],
    queryFn: () => apiClient.damages.listByAsset(code),
    enabled: !!code,
  });
  const events = useQuery({
    queryKey: ['events', code],
    queryFn: () => apiClient.assets.events(code),
    enabled: !!code,
  });
  const externalIds = useQuery({
    queryKey: ['external-ids', code],
    queryFn: () => apiClient.assets.listExternalIds(code),
    enabled: !!code,
  });
  const types = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => apiClient.assetTypes.list(),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });
  const usersList = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.users.list(),
    retry: false,
  });
  const assetLoans = useQuery({
    queryKey: ['asset-loans', code],
    queryFn: () => apiClient.loans.forAsset(code),
    enabled: !!code,
  });
  // Candidate parents for the kit (parent asset) picker in the edit form.
  const assetsList = useQuery({
    queryKey: ['assets', 'parent-options'],
    queryFn: () => apiClient.assets.list({ limit: 500 }),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['asset', code] });
    qc.invalidateQueries({ queryKey: ['damages', code] });
    qc.invalidateQueries({ queryKey: ['events', code] });
    qc.invalidateQueries({ queryKey: ['external-ids', code] });
    qc.invalidateQueries({ queryKey: ['asset-loans', code] });
    qc.invalidateQueries({ queryKey: ['assets'] });
  };

  const archive = useMutation({
    mutationFn: (status: 'sold' | 'lost' | 'retired' | 'damaged') =>
      apiClient.assets.archive(code, status),
    onSuccess: invalidateAll,
  });
  const unarchive = useMutation({
    mutationFn: () => apiClient.assets.unarchive(code),
    onSuccess: invalidateAll,
  });
  const repairStart = useMutation({
    mutationFn: () => apiClient.assets.repairStart(code),
    onSuccess: invalidateAll,
  });
  const repairFinish = useMutation({
    mutationFn: () => apiClient.assets.repairFinish(code),
    onSuccess: invalidateAll,
  });
  const assign = useMutation({
    mutationFn: (userId: string) => apiClient.assets.assign(code, userId),
    onSuccess: invalidateAll,
  });
  const unassign = useMutation({
    mutationFn: () => apiClient.assets.unassign(code),
    onSuccess: invalidateAll,
  });
  const resolveDamage = useMutation({
    mutationFn: (id: string) => apiClient.damages.resolve(id),
    onSuccess: invalidateAll,
  });
  const recordService = useMutation({
    mutationFn: () => apiClient.assets.service(code),
    onSuccess: () => {
      toast.success(t.assetDetail.serviceRecorded);
      invalidateAll();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // Every archive action is destructive (asset leaves the active list), so it
  // is gated behind a confirmation before the mutation fires.
  const archiveWithConfirm = async (
    status: 'sold' | 'lost' | 'retired',
    title: string,
    confirmLabel: string,
  ) => {
    if (
      await confirm({
        title,
        message: t.assetDetail.archiveMessage,
        confirmLabel,
        danger: true,
      })
    ) {
      archive.mutate(status);
    }
  };

  const [showDamageForm, setShowDamageForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);

  if (asset.isLoading) return <AssetDetailSkeleton />;
  if (asset.error) return <p className="text-red-600">{errorMessage(asset.error)}</p>;
  if (!asset.data) return null;

  const a = asset.data.asset;
  const isArchived = a.archivedAt !== null;
  const severityLabels: Record<DamageSeverity, string> = {
    minor: t.assetDetail.severityMinor,
    major: t.assetDetail.severityMajor,
    total: t.assetDetail.severityTotal,
  };
  const assetType = types.data?.items.find((type) => type.id === a.typeId);
  const customSchema: CustomFieldsSchema = assetType?.customFieldsSchema ?? [];

  const nextDue = nextServiceDue(a);
  const serviceState = serviceStatus(nextDue);

  // Straight-line depreciated value. Build a Date so the calc is robust whether
  // the API delivered a Date or an ISO string.
  const currentValue = currentAssetValue({
    purchasePrice: a.purchasePrice,
    purchasedAt: a.purchasedAt ? new Date(a.purchasedAt) : null,
    usefulLifeMonths: a.usefulLifeMonths,
  });
  const children = asset.data.children;
  const parent = asset.data.parent;
  // Exclude the current asset from the parent picker (can't be its own parent).
  const parentOptions = (assetsList.data?.items ?? [])
    .filter((item) => item.code !== a.code)
    .map((item) => ({ id: item.id, code: item.code, name: item.name }));

  const blockReason = nonLoanableReason(a.status);
  const loanWindows: BusyWindow[] = (assetLoans.data?.items ?? []).map((loan) => ({
    start: new Date(loan.status === 'planned' ? loan.loanedAt : (loan.startedAt ?? loan.loanedAt)),
    end: loan.expectedReturnAt ? new Date(loan.expectedReturnAt) : null,
    status: loan.status,
    label: loan.borrowerName,
  }));
  const nextFree = blockReason ? null : nextFreeAt(loanWindows);

  return (
    <article className="space-y-6">
      <Link to="/assets" className="text-sm text-slate-500 hover:underline">
        {t.assetDetail.backToList}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-slate-500">{a.code}</p>
          <h1 className="text-2xl font-bold">{a.name}</h1>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={a.status} />
            {isArchived && <span className="text-xs text-slate-500">{t.common.archived}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <img
            src={apiClient.assets.qrUrl(a.code)}
            alt={t.assetDetail.qrAlt(a.code)}
            className="w-32 h-32 border rounded bg-white"
          />
          <Link
            to={`/labels?codes=${encodeURIComponent(a.code)}`}
            className="text-xs text-blue-600 hover:underline"
          >
            {t.assetDetail.printLabel}
          </Link>
        </div>
      </div>

      <Card>
        <h2 className="font-semibold mb-2">{t.assetDetail.assignmentHeading}</h2>
        {a.assignedToUserId ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">
              {usersList.data?.items.find((u) => u.id === a.assignedToUserId)?.name ??
                a.assignedToUserId}
            </p>
            <Button
              variant="secondary"
              disabled={unassign.isPending}
              onClick={() => unassign.mutate()}
            >
              {t.assetDetail.removeAssignment}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Select
              className="flex-1"
              onChange={(e) => {
                if (!e.target.value) return;
                assign.mutate(e.target.value);
                e.target.value = '';
              }}
              defaultValue=""
              disabled={isArchived || a.status === 'on_loan' || assign.isPending}
            >
              <option value="" disabled>
                {t.assetDetail.selectUser}
              </option>
              {usersList.data?.items
                .filter((u) => !u.disabledAt)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
            </Select>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setShowEditForm((v) => !v)}>
          {t.common.edit}
        </Button>
        <Button variant="secondary" onClick={() => setShowDamageForm((v) => !v)}>
          {t.assetDetail.reportDamage}
        </Button>
        {!isArchived && a.serviceIntervalDays != null && (
          <Button
            variant="secondary"
            disabled={recordService.isPending}
            onClick={() => recordService.mutate()}
          >
            {t.assetDetail.recordService}
          </Button>
        )}
        {!isArchived ? (
          <>
            {a.status === 'in_repair' ? (
              <Button variant="secondary" onClick={() => repairFinish.mutate()}>
                {t.assetDetail.repairFinish}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => repairStart.mutate()}
                disabled={a.status === 'on_loan'}
                title={a.status === 'on_loan' ? t.assetDetail.onLoanTitle : undefined}
              >
                {t.assetDetail.repairStart}
              </Button>
            )}
            <Button
              variant="danger"
              disabled={archive.isPending}
              onClick={() =>
                archiveWithConfirm('sold', t.assetDetail.archiveSoldTitle, t.assetDetail.markSold)
              }
            >
              {t.assetDetail.markSold}
            </Button>
            <Button
              variant="danger"
              disabled={archive.isPending}
              onClick={() =>
                archiveWithConfirm('lost', t.assetDetail.archiveLostTitle, t.assetDetail.markLost)
              }
            >
              {t.assetDetail.markLost}
            </Button>
            <Button
              variant="danger"
              disabled={archive.isPending}
              onClick={() =>
                archiveWithConfirm(
                  'retired',
                  t.assetDetail.archiveRetiredTitle,
                  t.assetDetail.retire,
                )
              }
            >
              {t.assetDetail.retire}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => unarchive.mutate()}>
            {t.assetDetail.unarchive}
          </Button>
        )}
      </div>

      {showEditForm && (
        <EditAssetForm
          initial={{
            name: a.name,
            typeId: a.typeId ?? '',
            locationId: a.locationId ?? '',
            customFields: (a.customFields ?? {}) as Record<string, unknown>,
            purchasedAt: toDateInput(a.purchasedAt),
            warrantyUntil: toDateInput(a.warrantyUntil),
            purchasePrice: a.purchasePrice != null ? (a.purchasePrice / 100).toFixed(2) : '',
            supplier: a.supplier ?? '',
            serviceIntervalDays: a.serviceIntervalDays != null ? String(a.serviceIntervalDays) : '',
            lastServicedAt: toDateInput(a.lastServicedAt),
            usefulLifeMonths: a.usefulLifeMonths != null ? String(a.usefulLifeMonths) : '',
            parentAssetId: a.parentAssetId ?? '',
          }}
          types={types.data?.items ?? []}
          locationsList={locations.data?.items ?? []}
          parentOptions={parentOptions}
          customSchema={customSchema}
          onSubmit={async (values) => {
            const price = values.purchasePrice.trim().replace(',', '.');
            const priceNum = price ? Number(price) : NaN;
            const intervalRaw = values.serviceIntervalDays.trim();
            const intervalNum = intervalRaw ? Number(intervalRaw) : NaN;
            const lifeRaw = values.usefulLifeMonths.trim();
            const lifeNum = lifeRaw ? Number(lifeRaw) : NaN;
            await apiClient.assets.update(code, {
              name: values.name,
              typeId: values.typeId || null,
              locationId: values.locationId || null,
              customFields: values.customFields,
              purchasedAt: values.purchasedAt ? new Date(values.purchasedAt).toISOString() : null,
              warrantyUntil: values.warrantyUntil
                ? new Date(values.warrantyUntil).toISOString()
                : null,
              purchasePrice: Number.isFinite(priceNum) ? Math.round(priceNum * 100) : null,
              supplier: values.supplier.trim() || null,
              serviceIntervalDays:
                Number.isFinite(intervalNum) && intervalNum > 0 ? Math.round(intervalNum) : null,
              lastServicedAt: values.lastServicedAt
                ? new Date(values.lastServicedAt).toISOString()
                : null,
              usefulLifeMonths:
                Number.isFinite(lifeNum) && lifeNum > 0 ? Math.round(lifeNum) : null,
              parentAssetId: values.parentAssetId || null,
            });
            setShowEditForm(false);
            invalidateAll();
          }}
          onCancel={() => setShowEditForm(false)}
        />
      )}

      {showDamageForm && (
        <NewDamageForm
          onSubmit={async (values) => {
            await apiClient.damages.create(code, {
              assetId: a.code, // server resolves by code; field unused server-side
              occurredAt: values.occurredAt,
              description: values.description,
              severity: values.severity,
              photoPaths: values.photoPaths,
            });
            setShowDamageForm(false);
            invalidateAll();
          }}
          onCancel={() => setShowDamageForm(false)}
        />
      )}

      <Card>
        <h2 className="font-semibold mb-2">{t.assetDetail.detailsHeading}</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">{t.assetDetail.type}</dt>
          <dd>{assetType?.name ?? t.common.none}</dd>
          <dt className="text-slate-500">{t.assetDetail.location}</dt>
          <dd>
            {a.locationId
              ? locationPath(locations.data?.items ?? [], a.locationId) || t.common.none
              : t.common.none}
          </dd>
          <dt className="text-slate-500">{t.assetDetail.createdAt}</dt>
          <dd>{formatDate(a.createdAt)}</dd>
          <dt className="text-slate-500">{t.assetDetail.updatedAt}</dt>
          <dd>{formatDate(a.updatedAt)}</dd>
          <dt className="text-slate-500">{t.assetDetail.archivedAt}</dt>
          <dd>{a.archivedAt ? formatDate(a.archivedAt) : t.common.none}</dd>
          <dt className="text-slate-500">{t.assetDetail.purchasedAt}</dt>
          <dd>{a.purchasedAt ? formatDateOnly(a.purchasedAt) : t.common.none}</dd>
          <dt className="text-slate-500">{t.assetDetail.warrantyUntil}</dt>
          <dd>
            {a.warrantyUntil
              ? (() => {
                  const w = warrantyStatus(a.warrantyUntil);
                  return (
                    <span
                      className={
                        w === 'expired'
                          ? 'text-red-600 dark:text-red-400 font-medium'
                          : w === 'soon'
                            ? 'text-amber-600 dark:text-amber-400 font-medium'
                            : undefined
                      }
                    >
                      {formatDateOnly(a.warrantyUntil)}
                      {w === 'expired' && ` · ${t.assetDetail.warrantyExpired}`}
                      {w === 'soon' && ` · ${t.assetDetail.warrantyExpiringSoon}`}
                    </span>
                  );
                })()
              : t.common.none}
          </dd>
          <dt className="text-slate-500">{t.assetDetail.purchasePrice}</dt>
          <dd>{a.purchasePrice != null ? formatPrice(a.purchasePrice) : t.common.none}</dd>
          <dt className="text-slate-500">{t.assetDetail.currentValue}</dt>
          <dd>{currentValue != null ? formatPrice(currentValue) : t.common.none}</dd>
          <dt className="text-slate-500">{t.assetDetail.usefulLifeLabel}</dt>
          <dd>
            {a.usefulLifeMonths
              ? t.assetDetail.usefulLifeMonths(a.usefulLifeMonths)
              : t.common.none}
          </dd>
          <dt className="text-slate-500">{t.assetDetail.supplier}</dt>
          <dd>{a.supplier || t.common.none}</dd>
          <dt className="text-slate-500">{t.assetDetail.serviceIntervalLabel}</dt>
          <dd>
            {a.serviceIntervalDays
              ? t.assetDetail.serviceIntervalDays(a.serviceIntervalDays)
              : t.common.none}
          </dd>
          <dt className="text-slate-500">{t.assetDetail.lastServicedAt}</dt>
          <dd>{a.lastServicedAt ? formatDateOnly(a.lastServicedAt) : t.common.none}</dd>
          {a.serviceIntervalDays && nextDue && (
            <>
              <dt className="text-slate-500">{t.assetDetail.nextServiceDue}</dt>
              <dd>
                <span
                  className={
                    serviceState === 'overdue'
                      ? 'text-red-600 dark:text-red-400 font-medium'
                      : serviceState === 'soon'
                        ? 'text-amber-600 dark:text-amber-400 font-medium'
                        : undefined
                  }
                >
                  {formatDateOnly(nextDue)}
                  {serviceState === 'overdue' && ` · ${t.assetDetail.serviceOverdue}`}
                  {serviceState === 'soon' && ` · ${t.assetDetail.serviceDueSoon}`}
                </span>
              </dd>
            </>
          )}
          {customSchema.map((f) => {
            const value = (a.customFields ?? {})[f.key];
            return (
              <FragmentRow
                key={f.key}
                label={f.label}
                value={formatCustomFieldValue(f.type, value, {
                  yes: t.assetDetail.yes,
                  no: t.assetDetail.no,
                })}
              />
            );
          })}
        </dl>
      </Card>

      {(parent || children.length > 0) && (
        <Card>
          <h2 className="font-semibold mb-2">{t.assetDetail.kitHeading}</h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            {parent && (
              <>
                <dt className="text-slate-500">{t.assetDetail.kitParentLabel}</dt>
                <dd>
                  <Link
                    to={`/a/${parent.code}`}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <span className="font-mono">{parent.code}</span> — {parent.name}
                  </Link>
                </dd>
              </>
            )}
            {children.length > 0 && (
              <>
                <dt className="text-slate-500">{t.assetDetail.kitChildrenLabel}</dt>
                <dd>
                  <ul className="space-y-1">
                    {children.map((child) => (
                      <li key={child.code} className="flex items-center gap-2">
                        <Link
                          to={`/a/${child.code}`}
                          className="text-blue-600 hover:underline dark:text-blue-400"
                        >
                          <span className="font-mono">{child.code}</span> — {child.name}
                        </Link>
                        <StatusBadge status={child.status} />
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
        </Card>
      )}

      <ExternalIdsCard
        code={code}
        items={externalIds.data?.items ?? []}
        onChanged={invalidateAll}
      />

      <AssetPhotosCard code={code} photos={a.photoPaths ?? []} onChanged={invalidateAll} />

      <AssetDocumentsCard
        code={code}
        documents={a.documentPaths ?? []}
        emphasis={isArchived}
        onChanged={invalidateAll}
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="font-semibold">{t.assetDetail.reservationsHeading}</h2>
          {nextFree && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {nextFree.kind === 'now' && (
                <>
                  {t.assetDetail.freeLabel}{' '}
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">
                    {t.assetDetail.freeNow}
                  </span>
                </>
              )}
              {nextFree.kind === 'date' && (
                <>
                  {t.assetDetail.freeFrom(nextFree.date.toLocaleDateString(localeTag(getLocale())))}
                </>
              )}
              {nextFree.kind === 'never' && <>{t.assetDetail.loanedNoReturn}</>}
            </span>
          )}
        </div>
        <AvailabilityCalendar
          windows={loanWindows}
          blocked={blockReason ? { reason: blockReason } : undefined}
          onCreateLoan={
            blockReason
              ? undefined
              : (fromDay, toDay) =>
                  navigate(
                    `/loans/new?asset=${encodeURIComponent(a.code)}&start=${toISODate(
                      fromDay,
                    )}&end=${toISODate(toDay)}`,
                  )
          }
        />
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700" />
        {assetLoans.data?.items.length === 0 && (
          <p className="text-sm text-slate-500">{t.assetDetail.noActiveLoans}</p>
        )}
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {assetLoans.data?.items.map((loan) => (
            <li key={loan.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <Link to={`/loans/${loan.id}`} className="hover:underline">
                {loan.borrowerName}
              </Link>
              <span className="flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {formatDate(
                    loan.status === 'planned' ? loan.loanedAt : (loan.startedAt ?? loan.loanedAt),
                  )}
                  {' – '}
                  {loan.expectedReturnAt ? formatDate(loan.expectedReturnAt) : t.assetDetail.open}
                </span>
                <span
                  className={
                    loan.status === 'planned'
                      ? 'text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-800'
                      : 'text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800'
                  }
                >
                  {loan.status === 'planned' ? t.assetDetail.planned : t.assetDetail.onLoan}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="font-semibold mb-2">{t.assetDetail.damageHeading}</h2>
        {damages.data?.items.length === 0 && (
          <p className="text-sm text-slate-500">{t.assetDetail.noDamages}</p>
        )}
        <ul className="divide-y">
          {damages.data?.items.map((d) => (
            <li key={d.id} className="py-3 space-y-2">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <p className="text-sm">
                    <span className="font-medium">{d.description}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(d.occurredAt)} · {t.assetDetail.severityLabel}{' '}
                    <span
                      className={
                        d.severity === 'total'
                          ? 'text-red-600 font-medium'
                          : d.severity === 'major'
                            ? 'text-orange-600 font-medium'
                            : 'text-slate-700'
                      }
                    >
                      {severityLabels[d.severity]}
                    </span>
                  </p>
                </div>
                {d.resolvedAt ? (
                  <span className="text-xs text-slate-500">
                    {t.assetDetail.resolvedAt(formatDate(d.resolvedAt))}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    className="text-xs"
                    disabled={resolveDamage.isPending}
                    onClick={() => resolveDamage.mutate(d.id)}
                  >
                    {t.assetDetail.markResolved}
                  </Button>
                )}
              </div>
              {d.photoPaths.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {d.photoPaths.map((p, i) => (
                    <a
                      key={p}
                      href={`/api/uploads/${p}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-20 h-20 rounded border overflow-hidden bg-slate-50"
                    >
                      <img
                        src={`/api/uploads/${p}`}
                        alt={t.assetDetail.damagePhotoAlt(i + 1)}
                        className="w-full h-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="font-semibold mb-2">{t.assetDetail.historyHeading}</h2>
        <ul className="divide-y text-sm">
          {events.data?.items.map((e) => (
            <li key={e.id} className="py-1.5 flex justify-between gap-4">
              <span className="text-xs text-slate-500">
                {t.assetDetail.eventLabels[e.type] ?? e.type}
              </span>
              <span className="text-xs text-slate-500">{formatDate(e.occurredAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </article>
  );
}
