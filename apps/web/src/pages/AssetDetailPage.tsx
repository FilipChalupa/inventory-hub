import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { apiClient, uploadFile } from '../lib/api.js';
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  StatusBadge,
  Textarea,
  formatDate,
} from '../components/ui.js';
import { CustomFieldsValuesForm } from '../components/CustomFieldsValuesForm.js';
import type { CustomFieldsSchema, DamageSeverity } from '@inventory-hub/shared';

export function AssetDetailPage() {
  const { code = '' } = useParams<{ code: string }>();
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
  const types = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => apiClient.assetTypes.list(),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['asset', code] });
    qc.invalidateQueries({ queryKey: ['damages', code] });
    qc.invalidateQueries({ queryKey: ['events', code] });
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

  const [showDamageForm, setShowDamageForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);

  if (asset.isLoading) return <p className="text-slate-500">Načítám…</p>;
  if (asset.error) return <p className="text-red-600">{(asset.error as Error).message}</p>;
  if (!asset.data) return null;

  const a = asset.data.asset;
  const isArchived = a.archivedAt !== null;
  const assetType = types.data?.items.find((t) => t.id === a.typeId);
  const customSchema: CustomFieldsSchema = assetType?.customFieldsSchema ?? [];

  return (
    <article className="space-y-6">
      <Link to="/" className="text-sm text-slate-500 hover:underline">
        ← zpět na seznam
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-slate-500">{a.code}</p>
          <h1 className="text-2xl font-bold">{a.name}</h1>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={a.status} />
            {isArchived && <span className="text-xs text-slate-500">archivováno</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <img
            src={apiClient.assets.qrUrl(a.code)}
            alt={`QR ${a.code}`}
            className="w-32 h-32 border rounded bg-white"
          />
          <Link to={`/labels?codes=${encodeURIComponent(a.code)}`} className="text-xs text-blue-600 hover:underline">
            tisk štítku →
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setShowEditForm((v) => !v)}>
          Upravit
        </Button>
        <Button variant="secondary" onClick={() => setShowDamageForm((v) => !v)}>
          Nahlásit poškození
        </Button>
        {!isArchived ? (
          <>
            <Button variant="danger" onClick={() => archive.mutate('sold')}>
              Prodáno
            </Button>
            <Button variant="danger" onClick={() => archive.mutate('lost')}>
              Ztraceno
            </Button>
            <Button variant="danger" onClick={() => archive.mutate('retired')}>
              Vyřadit
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => unarchive.mutate()}>
            Vrátit z archivu
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
          locations={locations.data?.items ?? []}
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
        <h2 className="font-semibold mb-2">Detaily</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">Vytvořeno</dt>
          <dd>{formatDate(a.createdAt)}</dd>
          <dt className="text-slate-500">Aktualizováno</dt>
          <dd>{formatDate(a.updatedAt)}</dd>
          <dt className="text-slate-500">Archivováno</dt>
          <dd>{a.archivedAt ? formatDate(a.archivedAt) : '—'}</dd>
          {customSchema.map((f) => {
            const value = (a.customFields ?? {})[f.key];
            return (
              <FragmentRow
                key={f.key}
                label={f.label}
                value={formatCustomFieldValue(f.type, value)}
              />
            );
          })}
        </dl>
      </Card>

      <Card>
        <h2 className="font-semibold mb-2">Poškození</h2>
        {damages.data?.items.length === 0 && (
          <p className="text-sm text-slate-500">Žádná hlášená poškození.</p>
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
                    {formatDate(d.occurredAt)} · severity:{' '}
                    <span
                      className={
                        d.severity === 'total'
                          ? 'text-red-600 font-medium'
                          : d.severity === 'major'
                            ? 'text-orange-600 font-medium'
                            : 'text-slate-700'
                      }
                    >
                      {d.severity}
                    </span>
                  </p>
                </div>
                {d.resolvedAt ? (
                  <span className="text-xs text-slate-500">opraveno {formatDate(d.resolvedAt)}</span>
                ) : (
                  <Button
                    variant="ghost"
                    className="text-xs"
                    onClick={async () => {
                      await apiClient.damages.resolve(d.id);
                      invalidateAll();
                    }}
                  >
                    označit opravené
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
        <h2 className="font-semibold mb-2">Historie</h2>
        <ul className="divide-y text-sm">
          {events.data?.items.map((e) => (
            <li key={e.id} className="py-1.5 flex justify-between gap-4">
              <span className="font-mono text-xs text-slate-500">{e.type}</span>
              <span className="text-xs text-slate-500">{formatDate(e.occurredAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </article>
  );
}

function EditAssetForm({
  initial,
  types,
  locations,
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
  locations: { id: string; name: string }[];
  customSchema: CustomFieldsSchema;
  onSubmit: (v: {
    name: string;
    typeId: string;
    locationId: string;
    customFields: Record<string, unknown>;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const { register, handleSubmit } = useForm({ defaultValues: initial });
  const [customFieldValues, setCustomFieldValues] = useState(initial.customFields);
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={handleSubmit((v) => onSubmit({ ...v, customFields: customFieldValues }))}
      >
        <Field label="Název">
          <Input {...register('name', { required: true })} />
        </Field>
        <Field label="Typ">
          <Select {...register('typeId')}>
            <option value="">— bez typu —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lokace">
          <Select {...register('locationId')}>
            <option value="">— bez lokace —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        {customSchema.length > 0 && (
          <div className="border-t pt-3">
            <h3 className="font-medium text-sm text-slate-700 mb-2">Vlastní pole</h3>
            <CustomFieldsValuesForm
              schema={customSchema}
              values={customFieldValues}
              onChange={setCustomFieldValues}
            />
          </div>
        )}
        <div className="flex gap-2">
          <Button type="submit">Uložit</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Zrušit
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

function formatCustomFieldValue(type: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  switch (type) {
    case 'boolean':
      return value ? 'Ano' : 'Ne';
    case 'date':
      return typeof value === 'string'
        ? new Date(value).toLocaleDateString('cs-CZ')
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
  const today = new Date().toISOString().slice(0, 16);
  const { register, handleSubmit } = useForm<{
    occurredAt: string;
    description: string;
    severity: DamageSeverity;
  }>({
    defaultValues: { occurredAt: today, description: '', severity: 'minor' },
  });
  const [photos, setPhotos] = useState<{ path: string; previewUrl: string }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        Array.from(files).map(async (file) => {
          const res = await uploadFile(file);
          return { path: res.path, previewUrl: URL.createObjectURL(file) };
        }),
      );
      setPhotos((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={handleSubmit((v) =>
          onSubmit({
            ...v,
            occurredAt: new Date(v.occurredAt),
            photoPaths: photos.map((p) => p.path),
          }),
        )}
      >
        <Field label="Kdy se to stalo">
          <Input type="datetime-local" {...register('occurredAt', { required: true })} />
        </Field>
        <Field label="Popis">
          <Textarea rows={3} {...register('description', { required: true })} />
        </Field>
        <Field label="Závažnost">
          <Select {...register('severity')}>
            <option value="minor">Malé (lze používat)</option>
            <option value="major">Velké (omezené použití)</option>
            <option value="total">Totální (asset → poškozen + archiv)</option>
          </Select>
        </Field>
        <Field label="Fotky (volitelné)">
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
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white/90 text-xs leading-none border"
                  aria-label="Odebrat"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {uploading && <p className="text-xs text-slate-500">Nahrávám fotky…</p>}
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={uploading}>
            Zaznamenat
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Zrušit
          </Button>
        </div>
      </form>
    </Card>
  );
}
