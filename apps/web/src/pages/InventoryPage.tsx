import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient, type InventorySessionRow } from '../lib/api.js';
import { Button, Card, Field, Input, formatDate } from '../components/ui.js';
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
  const [error, setError] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['inventory'],
    queryFn: () => apiClient.inventory.list(),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });

  const create = useMutation({
    mutationFn: () =>
      apiClient.inventory.create({
        name: name.trim() || undefined,
        locationId: locationId || null,
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
          <Field label="Rozsah (lokace)">
            <LocationSelect
              locations={locations.data?.items ?? []}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              placeholder="— celá organizace —"
            />
          </Field>
          <p className="text-xs text-slate-500">
            Když vybereš lokaci, do inventury patří assety v ní i ve všech jejích
            podlokacích. Bez výběru se kontroluje celá organizace.
          </p>
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

      {sessions.isLoading && <p className="text-sm text-slate-500">Načítám…</p>}

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
