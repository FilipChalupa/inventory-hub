import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient, uploadFile } from '../lib/api.js';
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
  formatDate,
} from '../components/ui.js';
import { confirm } from '../components/ConfirmDialog.js';
import { CustomFieldsValuesForm } from '../components/CustomFieldsValuesForm.js';
import { AvailabilityCalendar } from '../components/AvailabilityCalendar.js';
import { nextFreeAt, nonLoanableReason, toISODate, type BusyWindow } from '../lib/availability.js';
import { LocationSelect } from '../components/LocationSelect.js';
import { locationPath } from '../lib/locations.js';
import type { LocationRow } from '../lib/api.js';
import {
  MAX_DAMAGE_PHOTOS,
  validateCustomFieldValues,
  type CustomFieldsSchema,
  type DamageSeverity,
} from '@inventory-hub/shared';
import { useT, getLocale } from '../i18n/index.js';
import { localeTag } from '../i18n/util.js';

/** Placeholder mirroring the detail layout while the asset query loads. */
function AssetDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-32 w-32" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

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
          }}
          types={types.data?.items ?? []}
          locationsList={locations.data?.items ?? []}
          customSchema={customSchema}
          onSubmit={async (values) => {
            await apiClient.assets.update(code, {
              name: values.name,
              typeId: values.typeId || null,
              locationId: values.locationId || null,
              customFields: values.customFields,
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
                  {d.photoPaths.map((p) => (
                    <a
                      key={p}
                      href={`/api/uploads/${p}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-20 h-20 rounded border overflow-hidden bg-slate-50"
                    >
                      <img
                        src={`/api/uploads/${p}`}
                        alt=""
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

function AssetDocumentsCard({
  code,
  documents,
  emphasis,
  onChanged,
}: {
  code: string;
  documents: string[];
  emphasis: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const res = await uploadFile(file);
        await apiClient.assets.addDocument(code, res.path);
      }
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function remove(path: string) {
    if (
      !(await confirm({
        title: t.assetDetail.removeDocumentTitle,
        confirmLabel: t.assetDetail.remove,
        danger: true,
      }))
    )
      return;
    try {
      await apiClient.assets.removeDocument(code, path);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card className={emphasis ? 'border-amber-300 dark:border-amber-700' : undefined}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">
          {t.assetDetail.documentsHeading}
          {emphasis && (
            <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
              {t.assetDetail.documentsArchivedHint}
            </span>
          )}
        </h2>
        <label className="inline-flex items-center text-xs cursor-pointer text-blue-600 hover:underline">
          {t.assetDetail.upload}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      </div>
      {uploading && <p className="text-xs text-slate-500">{t.assetDetail.uploading}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {documents.length === 0 ? (
        <p className="text-sm text-slate-500">{t.assetDetail.noDocuments}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {documents.map((p) => {
            const isPdf = p.toLowerCase().endsWith('.pdf');
            const name = p.split('/').pop() ?? p;
            return (
              <li key={p} className="flex items-center justify-between py-1.5 text-sm">
                <a
                  href={`/api/uploads/${p}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline truncate min-w-0"
                >
                  {isPdf ? '📄' : '🖼️'} {name}
                </a>
                <Button variant="ghost" className="text-red-600 text-xs" onClick={() => remove(p)}>
                  {t.assetDetail.remove}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ExternalIdsCard({
  code,
  items,
  onChanged,
}: {
  code: string;
  items: { id: string; kind: string; value: string }[];
  onChanged: () => void;
}) {
  const t = useT();
  const [kind, setKind] = useState('serial');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await apiClient.assets.addExternalId(code, { kind: kind.trim(), value: value.trim() });
      setValue('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (
      !(await confirm({
        title: t.assetDetail.removeExternalIdTitle,
        confirmLabel: t.assetDetail.remove,
        danger: true,
      }))
    )
      return;
    try {
      await apiClient.assets.removeExternalId(code, id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card>
      <h2 className="font-semibold mb-2">{t.assetDetail.externalIdsHeading}</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
        {t.assetDetail.externalIdsHint}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{t.assetDetail.noExternalIds}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 mb-3">
          {items.map((eid) => (
            <li key={eid.id} className="flex items-center justify-between py-1.5 text-sm">
              <span>
                <span className="text-xs uppercase text-slate-500 dark:text-slate-400 mr-2">
                  {eid.kind}
                </span>
                <span className="font-mono">{eid.value}</span>
              </span>
              <Button
                variant="ghost"
                className="text-red-600 text-xs"
                onClick={() => remove(eid.id)}
              >
                {t.assetDetail.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2 items-end">
        <div className="w-32">
          <Field label={t.assetDetail.type}>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="serial">{t.assetDetail.kindSerial}</option>
              <option value="ean">{t.assetDetail.kindEan}</option>
              <option value="sku">{t.assetDetail.kindSku}</option>
              <option value="other">{t.assetDetail.kindOther}</option>
            </Select>
          </Field>
        </div>
        <div className="flex-1 min-w-[180px]">
          <Field label={t.assetDetail.valueLabel} required>
            <Input value={value} onChange={(e) => setValue(e.target.value)} className="font-mono" />
          </Field>
        </div>
        <Button type="submit" disabled={busy || !value.trim()}>
          {t.common.add}
        </Button>
      </form>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </Card>
  );
}

function AssetPhotosCard({
  code,
  photos,
  onChanged,
}: {
  code: string;
  photos: string[];
  onChanged: () => void;
}) {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const res = await uploadFile(file);
        await apiClient.assets.addPhoto(code, res.path);
      }
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(path: string) {
    if (
      !(await confirm({
        title: t.assetDetail.removePhotoTitle,
        confirmLabel: t.assetDetail.remove,
        danger: true,
      }))
    )
      return;
    try {
      await apiClient.assets.removePhoto(code, path);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">{t.assetDetail.photosHeading}</h2>
        <label className="inline-flex items-center text-xs cursor-pointer text-blue-600 hover:underline">
          {t.assetDetail.upload}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      </div>
      {uploading && <p className="text-xs text-slate-500">{t.assetDetail.uploading}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {photos.length === 0 ? (
        <p className="text-sm text-slate-500">{t.assetDetail.noPhotos}</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {photos.map((p) => (
            <div
              key={p}
              className="relative w-24 h-24 rounded border overflow-hidden bg-slate-50 group"
            >
              <a
                href={`/api/uploads/${p}`}
                target="_blank"
                rel="noreferrer"
                className="block w-full h-full"
              >
                <img src={`/api/uploads/${p}`} alt="" className="w-full h-full object-cover" />
              </a>
              <button
                type="button"
                onClick={() => removePhoto(p)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 text-slate-700 text-xs leading-none border opacity-0 group-hover:opacity-100"
                aria-label={t.assetDetail.remove}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function EditAssetForm({
  initial,
  types,
  locationsList,
  customSchema,
  onSubmit,
  onCancel,
}: {
  initial: {
    name: string;
    typeId: string;
    locationId: string;
    customFields: Record<string, unknown>;
  };
  types: { id: string; name: string; codePrefix: string }[];
  locationsList: LocationRow[];
  customSchema: CustomFieldsSchema;
  onSubmit: (v: {
    name: string;
    typeId: string;
    locationId: string;
    customFields: Record<string, unknown>;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const { register, handleSubmit, formState } = useForm({ defaultValues: initial });
  const [customFieldValues, setCustomFieldValues] = useState(initial.customFields);
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (v) => {
          const cf = validateCustomFieldValues(customSchema, customFieldValues);
          if (!cf.ok) {
            setCustomFieldErrors(cf.errors);
            return;
          }
          setCustomFieldErrors({});
          setSubmitError(null);
          setSaving(true);
          try {
            await onSubmit({ ...v, customFields: customFieldValues });
          } catch (err) {
            setSubmitError(errorMessage(err));
          } finally {
            setSaving(false);
          }
        })}
      >
        <Field
          label={t.assetDetail.nameLabel}
          required
          error={formState.errors.name ? t.assetDetail.nameRequired : undefined}
        >
          <Input {...register('name', { required: true })} />
        </Field>
        <Field label={t.assetDetail.type}>
          <Select {...register('typeId')}>
            <option value="">{t.assetDetail.noType}</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.assetDetail.location}>
          <LocationSelect locations={locationsList} {...register('locationId')} />
        </Field>
        {customSchema.length > 0 && (
          <div className="border-t pt-3">
            <h3 className="font-medium text-sm text-slate-700 mb-2">
              {t.assetDetail.customFields}
            </h3>
            <CustomFieldsValuesForm
              schema={customSchema}
              values={customFieldValues}
              onChange={setCustomFieldValues}
              errors={customFieldErrors}
            />
          </div>
        )}
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? t.common.saving : t.common.save}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t.common.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd>{value || '—'}</dd>
    </>
  );
}

function formatCustomFieldValue(
  type: string,
  value: unknown,
  labels: { yes: string; no: string },
): string {
  if (value === undefined || value === null || value === '') return '';
  switch (type) {
    case 'boolean':
      return value ? labels.yes : labels.no;
    case 'date':
      return typeof value === 'string'
        ? new Date(value).toLocaleDateString(localeTag(getLocale()))
        : String(value);
    default:
      return String(value);
  }
}

function NewDamageForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (v: {
    occurredAt: Date;
    description: string;
    severity: DamageSeverity;
    photoPaths: string[];
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 16);
  const { register, handleSubmit, formState } = useForm<{
    occurredAt: string;
    description: string;
    severity: DamageSeverity;
  }>({
    defaultValues: { occurredAt: today, description: '', severity: 'minor' },
  });
  const [photos, setPhotos] = useState<{ path: string; previewUrl: string }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    const remaining = MAX_DAMAGE_PHOTOS - photos.length;
    if (remaining <= 0) {
      setUploadError(t.assetDetail.maxPhotos(MAX_DAMAGE_PHOTOS));
      return;
    }
    const slice = Array.from(files).slice(0, remaining);
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        slice.map(async (file) => {
          const res = await uploadFile(file);
          return { path: res.path, previewUrl: URL.createObjectURL(file) };
        }),
      );
      setPhotos((prev) => [...prev, ...uploaded]);
      if (files.length > slice.length) {
        setUploadError(t.assetDetail.someNotUploaded(MAX_DAMAGE_PHOTOS));
      }
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (v) => {
          setSubmitError(null);
          setSaving(true);
          try {
            await onSubmit({
              ...v,
              occurredAt: new Date(v.occurredAt),
              photoPaths: photos.map((p) => p.path),
            });
          } catch (err) {
            setSubmitError(errorMessage(err));
          } finally {
            setSaving(false);
          }
        })}
      >
        <Field
          label={t.assetDetail.damageWhenLabel}
          required
          error={formState.errors.occurredAt ? t.assetDetail.damageWhenRequired : undefined}
        >
          <Input type="datetime-local" {...register('occurredAt', { required: true })} />
        </Field>
        <Field
          label={t.assetDetail.damageDescriptionLabel}
          required
          error={formState.errors.description ? t.assetDetail.damageDescriptionRequired : undefined}
        >
          <Textarea rows={3} {...register('description', { required: true })} />
        </Field>
        <Field label={t.assetDetail.severityHeadingLabel}>
          <Select {...register('severity')}>
            <option value="minor">{t.assetDetail.severityMinor}</option>
            <option value="major">{t.assetDetail.severityMajor}</option>
            <option value="total">{t.assetDetail.severityTotal}</option>
          </Select>
        </Field>
        <Field label={t.assetDetail.photosOptionalLabel}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-slate-100 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
        </Field>
        {photos.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {photos.map((p, idx) => (
              <div
                key={p.path}
                className="relative w-20 h-20 rounded border overflow-hidden bg-slate-50"
              >
                <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white/90 text-slate-700 text-xs leading-none border"
                  aria-label={t.assetDetail.remove}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {uploading && <p className="text-xs text-slate-500">{t.assetDetail.uploadingPhotos}</p>}
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={uploading || saving}>
            {saving ? t.common.saving : t.assetDetail.record}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t.common.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
