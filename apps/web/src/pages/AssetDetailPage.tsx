import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
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
import type { DamageSeverity } from '@inventory-hub/shared';

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
          }}
          types={types.data?.items ?? []}
          locations={locations.data?.items ?? []}
          onSubmit={async (values) => {
            await apiClient.assets.update(code, {
              name: values.name,
              typeId: values.typeId || null,
              locationId: values.locationId || null,
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
              photoPaths: [],
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
        </dl>
      </Card>

      <Card>
        <h2 className="font-semibold mb-2">Poškození</h2>
        {damages.data?.items.length === 0 && (
          <p className="text-sm text-slate-500">Žádná hlášená poškození.</p>
        )}
        <ul className="divide-y">
          {damages.data?.items.map((d) => (
            <li key={d.id} className="py-2 flex justify-between items-start gap-4">
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
  onSubmit,
  onCancel,
}: {
  initial: { name: string; typeId: string; locationId: string };
  types: { id: string; name: string; codePrefix: string }[];
  locations: { id: string; name: string }[];
  onSubmit: (v: { name: string; typeId: string; locationId: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const { register, handleSubmit } = useForm({ defaultValues: initial });
  return (
    <Card>
      <form className="space-y-3" onSubmit={handleSubmit(onSubmit)}>
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

function NewDamageForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (v: { occurredAt: Date; description: string; severity: DamageSeverity }) => Promise<void>;
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
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={handleSubmit((v) =>
          onSubmit({ ...v, occurredAt: new Date(v.occurredAt) }),
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
        <div className="flex gap-2">
          <Button type="submit">Zaznamenat</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Zrušit
          </Button>
        </div>
      </form>
    </Card>
  );
}
