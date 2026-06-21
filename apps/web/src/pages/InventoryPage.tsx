import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient, type InventorySessionRow } from '../lib/api.js';
import { Button, Card, Field, Input, SkeletonList, Textarea, formatDate } from '../components/ui.js';
import { LocationSelect } from '../components/LocationSelect.js';
import { locationPath } from '../lib/locations.js';
import { hasRole, useCurrentUser } from '../auth/AuthContext.js';

export function InventoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = hasRole(useCurrentUser(), 'admin', 'operator');

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [pickedAssetCodes, setPickedAssetCodes] = useState<string[]>([]);
  const [assetSearch, setAssetSearch] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['inventory'],
    queryFn: () => apiClient.inventory.list(),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });
  const types = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => apiClient.assetTypes.list(),
  });
  const assetList = useQuery({
    queryKey: ['assets', { q: assetSearch }],
    queryFn: () => apiClient.assets.list({ q: assetSearch || undefined }),
    enabled: creating,
  });

  // A hand-picked asset list takes over the scope; the location/type filters
  // are ignored server-side in that case, so reflect that in the payload.
  const picking = pickedAssetCodes.length > 0;
  const create = useMutation({
    mutationFn: () =>
      apiClient.inventory.create({
        name: name.trim() || undefined,
        locationId: picking ? null : locationId || null,
        typeIds: picking || typeIds.length === 0 ? undefined : typeIds,
        assetCodes: picking ? pickedAssetCodes : undefined,
        note: note.trim() || null,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      navigate(`/inventory/${res.session.id}`);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Chyba'),
  });

  const items = sessions.data?.items ?? [];
  const locationName = (id: string | null) =>
    id ? locationPath(locations.data?.items ?? [], id) || '—' : 'Celá organizace';

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Inventury</h1>
        {canWrite && !creating && (
          <Button onClick={() => setCreating(true)}>+ Nová inventura</Button>
        )}
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">
        Inventura zkontroluje, že fyzicky existuje vše, co je v evidenci. Spustíš
        ji pro celou organizaci nebo pro vybranou lokaci, naskenuješ co máš v ruce
        a systém ti vypíše, co chybí a co je navíc.
      </p>

      {creating && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Nová inventura</h2>
          <Field label="Název (volitelný)">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Inventura — sklad A"
            />
          </Field>
          <div className={picking ? 'space-y-2 opacity-50 pointer-events-none' : 'space-y-2'}>
            <Field label="Rozsah (lokace)">
              <LocationSelect
                locations={locations.data?.items ?? []}
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                placeholder="— celá organizace —"
              />
            </Field>
            <div>
              <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                Typy assetů (volitelné)
              </span>
              {types.data?.items.length === 0 ? (
                <p className="text-xs text-slate-500">Žádné typy.</p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {types.data?.items.map((t) => (
                    <label key={t.id} className="inline-flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={typeIds.includes(t.id)}
                        onChange={() =>
                          setTypeIds((prev) =>
                            prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                          )
                        }
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Bez výběru se kontroluje celá organizace. Lokace a typy se kombinují (průnik).
            </p>
          </div>

          <Field label="Nebo ručně vybrat assety (volitelné)">
            <Input
              type="search"
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
              placeholder="Hledat kód / název…"
              className="mb-2"
            />
            <ul className="max-h-48 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700 rounded border border-slate-200 dark:border-slate-700">
              {assetList.data?.items.length === 0 && (
                <li className="p-2 text-sm text-slate-500">Žádné assety neodpovídají hledání.</li>
              )}
              {assetList.data?.items.map((a) => {
                const checked = pickedAssetCodes.includes(a.code);
                return (
                  <li key={a.code} className="flex items-center gap-2 p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setPickedAssetCodes((prev) =>
                          checked ? prev.filter((x) => x !== a.code) : [...prev, a.code],
                        )
                      }
                    />
                    <span className="font-mono text-xs text-slate-500 w-28 shrink-0">{a.code}</span>
                    <span className="flex-1 truncate">{a.name}</span>
                  </li>
                );
              })}
            </ul>
            {picking && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                Vybráno {pickedAssetCodes.length} assetů — lokace a typy se ignorují.{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setPickedAssetCodes([])}
                >
                  Vyčistit výběr
                </button>
              </p>
            )}
          </Field>

          <Field label="Poznámka (volitelné)">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? 'Zakládám…' : 'Spustit inventuru'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
            >
              Zrušit
            </Button>
          </div>
        </Card>
      )}

      {sessions.isLoading && <SkeletonList rows={4} />}

      {!sessions.isLoading && items.length === 0 && !creating && (
        <Card>
          <p className="text-slate-600 text-sm">
            Zatím žádná inventura. {canWrite ? 'Spusť první tlačítkem nahoře.' : ''}
          </p>
        </Card>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
          {items.map((s) => (
            <SessionRow key={s.id} session={s} locationName={locationName(s.locationId)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionRow({
  session,
  locationName,
}: {
  session: InventorySessionRow;
  locationName: string;
}) {
  return (
    <li className="hover:bg-slate-50 dark:hover:bg-slate-700">
      <Link to={`/inventory/${session.id}`} className="flex items-center justify-between p-3 gap-4">
        <div>
          <div className="font-medium">{session.name}</div>
          <div className="text-xs text-slate-500">
            {locationName} · založeno {formatDate(session.createdAt)} ·{' '}
            {session.scanCount ?? 0} naskenováno
          </div>
        </div>
        <span
          className={
            'text-xs px-2 py-0.5 rounded font-medium ' +
            (session.status === 'open'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-emerald-100 text-emerald-800')
          }
        >
          {session.status === 'open' ? 'Probíhá' : 'Uzavřeno'}
        </span>
      </Link>
    </li>
  );
}
