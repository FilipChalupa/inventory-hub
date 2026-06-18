import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  apiClient,
  type InventoryReport,
  type InventoryReportAsset,
  type InventorySessionRow,
  type ScanResult,
} from '../lib/api.js';
import { Button, Card, Input, StatusBadge, Textarea, formatDate } from '../components/ui.js';
import { locationPath } from '../lib/locations.js';
import { parseScannedValue } from '../lib/scan.js';
import { hasRole, useCurrentUser } from '../auth/AuthContext.js';

const SCANNER_ELEMENT_ID = 'inventory-scanner-region';

type Detail = { session: InventorySessionRow; report: InventoryReport };

export function InventorySessionPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const canWrite = hasRole(useCurrentUser(), 'admin', 'operator');

  const [lastResult, setLastResult] = useState<{ kind: ScanResult['result']; text: string } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['inventory', id],
    queryFn: () => apiClient.inventory.get(id),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => apiClient.locations.list(),
  });

  const session = detail.data?.session;
  const report = detail.data?.report;
  const isOpen = session?.status === 'open';

  // Write the fresh report straight into the cache. The service worker serves
  // GET /api/* stale-while-revalidate, so relying on a refetch would show
  // stale counts until a reload — the mutations return the report instead.
  const applyReport = (next: InventoryReport) =>
    queryClient.setQueryData<Detail>(['inventory', id], (old) => (old ? { ...old, report: next } : old));

  const scan = useMutation({
    mutationFn: (code: string) => apiClient.inventory.scan(id, code),
    onSuccess: (res) => {
      const label = `${res.asset.code} — ${res.asset.name}`;
      setLastResult({
        kind: res.result,
        text:
          res.result === 'found'
            ? `✓ ${label}`
            : res.result === 'already'
              ? `↺ ${label} (už naskenováno)`
              : `⚠ ${label} (mimo rozsah / archivováno)`,
      });
      applyReport(res.report);
    },
    onError: (e: unknown) =>
      setLastResult({ kind: 'unexpected', text: e instanceof Error ? e.message : 'Chyba skenu' }),
  });

  const itemNote = useMutation({
    mutationFn: (v: { assetId: string; note: string }) =>
      apiClient.inventory.setItemNote(id, v.assetId, v.note),
    onSuccess: (res) => applyReport(res.report),
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : 'Chyba'),
  });

  const saveSessionNote = useMutation({
    mutationFn: (note: string) =>
      apiClient.inventory.update(id, { note: note.trim() ? note.trim() : null }),
    onSuccess: (_res, note) =>
      queryClient.setQueryData<Detail>(['inventory', id], (old) =>
        old ? { ...old, session: { ...old.session, note: note.trim() ? note.trim() : null } } : old,
      ),
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : 'Chyba'),
  });

  // Patch the session's status into the cache directly (same stale-SW reason
  // as the report) and refresh the list in the background.
  const setStatus = (status: 'open' | 'closed') => {
    queryClient.setQueryData<Detail>(['inventory', id], (old) =>
      old
        ? {
            ...old,
            session: {
              ...old.session,
              status,
              closedAt: status === 'closed' ? new Date().toISOString() : null,
            },
          }
        : old,
    );
    void queryClient.invalidateQueries({ queryKey: ['inventory'], exact: true });
  };

  const close = useMutation({
    mutationFn: () => apiClient.inventory.close(id),
    onSuccess: () => setStatus('closed'),
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : 'Chyba'),
  });
  const reopen = useMutation({
    mutationFn: () => apiClient.inventory.reopen(id),
    onSuccess: () => setStatus('open'),
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : 'Chyba'),
  });
  const markLost = useMutation({
    mutationFn: (codes: string[]) => apiClient.inventory.markLost(id, codes),
    onSuccess: (res) => {
      applyReport(res.report);
      void queryClient.invalidateQueries({ queryKey: ['inventory'], exact: true });
    },
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : 'Chyba'),
  });

  const locationLabel = (locId: string | null) =>
    locId ? locationPath(locations.data?.items ?? [], locId) || '—' : '—';

  if (detail.isLoading) return <p className="text-sm text-slate-500">Načítám…</p>;
  if (!session || !report) {
    return (
      <section className="space-y-3">
        <Link to="/inventory" className="text-sm text-slate-500 hover:underline">
          ← zpět na inventury
        </Link>
        <p className="text-sm text-red-600">Inventura nenalezena.</p>
      </section>
    );
  }

  const scopeLabel =
    session.assetIds && session.assetIds.length > 0
      ? `ručně vybráno ${session.assetIds.length} assetů`
      : [
          session.locationId ? locationLabel(session.locationId) : 'celá organizace',
          session.typeIds && session.typeIds.length > 0
            ? `${session.typeIds.length} ${session.typeIds.length === 1 ? 'typ' : 'typů'}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const onSaveNote = canWrite
    ? (assetId: string, note: string) => itemNote.mutate({ assetId, note })
    : undefined;

  return (
    <section className="space-y-4">
      <Link to="/inventory" className="text-sm text-slate-500 hover:underline">
        ← zpět na inventury
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{session.name}</h1>
          <p className="text-sm text-slate-500">
            Rozsah: {scopeLabel} · založeno {formatDate(session.createdAt)}
            {session.status === 'closed' && session.closedAt
              ? ` · uzavřeno ${formatDate(session.closedAt)}`
              : ''}
          </p>
        </div>
        <span
          className={
            'text-xs px-2 py-0.5 rounded font-medium ' +
            (isOpen ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')
          }
        >
          {isOpen ? 'Probíhá' : 'Uzavřeno'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Očekáváno" value={report.counts.expected} />
        <Stat label="Nalezeno" value={report.counts.found} tone="emerald" />
        <Stat label="Chybí" value={report.counts.missing} tone="red" />
        <Stat label="Navíc" value={report.counts.unexpected} tone="amber" />
      </div>

      <SessionNote
        note={session.note}
        canWrite={canWrite}
        saving={saveSessionNote.isPending}
        onSave={(note) => saveSessionNote.mutate(note)}
      />

      {canWrite && isOpen && (
        <ScanPanel
          onCode={(code) => scan.mutate(code)}
          pending={scan.isPending}
          lastResult={lastResult}
        />
      )}

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {isOpen ? (
            <Button variant="secondary" onClick={() => close.mutate()} disabled={close.isPending}>
              Uzavřít inventuru
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              Znovu otevřít
            </Button>
          )}
          {report.missing.length > 0 && (
            <Button
              variant="danger"
              disabled={markLost.isPending}
              onClick={() => {
                const losable = report.missing.filter((m) => m.status !== 'on_loan');
                if (losable.length === 0) return;
                if (
                  window.confirm(
                    `Označit ${losable.length} chybějících assetů jako ztracené? Přejdou do archivu.`,
                  )
                ) {
                  markLost.mutate(losable.map((m) => m.code));
                }
              }}
            >
              Označit chybějící jako ztracené
            </Button>
          )}
        </div>
      )}

      <AssetGroup
        title="Chybí"
        hint="V evidenci, ale nenaskenováno. Položky na výpůjčce nejsou fyzicky na místě — to je očekávané."
        assets={report.missing}
        locationLabel={locationLabel}
        emptyText="Nic nechybí 🎉"
        canWrite={canWrite}
        onSaveNote={onSaveNote}
        onMarkFound={canWrite && isOpen ? (code) => scan.mutate(code) : undefined}
      />
      <AssetGroup
        title="Navíc / mimo rozsah"
        hint="Naskenováno, ale nepatří do očekávaného rozsahu (archivováno nebo na jiné lokaci)."
        assets={report.unexpected}
        locationLabel={locationLabel}
        emptyText="Nic navíc."
        canWrite={canWrite}
        onSaveNote={onSaveNote}
      />
      <AssetGroup
        title="Nalezeno"
        assets={report.found}
        locationLabel={locationLabel}
        emptyText="Zatím nic naskenováno."
        canWrite={canWrite}
        onSaveNote={onSaveNote}
      />
    </section>
  );
}

function SessionNote({
  note,
  canWrite,
  saving,
  onSave,
}: {
  note: string | null;
  canWrite: boolean;
  saving: boolean;
  onSave: (note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? '');

  if (!canWrite) {
    if (!note) return null;
    return (
      <Card>
        <h2 className="font-semibold mb-1 text-sm">Poznámka</h2>
        <p className="text-sm whitespace-pre-wrap">{note}</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Poznámka k inventuře</h2>
        {!editing && (
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() => {
              setDraft(note ?? '');
              setEditing(true);
            }}
          >
            {note ? 'Upravit' : 'Přidat'}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex gap-2">
            <Button
              disabled={saving}
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
            >
              {saving ? 'Ukládám…' : 'Uložit'}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Zrušit
            </Button>
          </div>
        </div>
      ) : note ? (
        <p className="text-sm whitespace-pre-wrap">{note}</p>
      ) : (
        <p className="text-sm text-slate-400">Bez poznámky.</p>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'emerald' | 'red' | 'amber';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-600'
      : tone === 'red'
        ? 'text-red-600'
        : tone === 'amber'
          ? 'text-amber-600'
          : 'text-slate-900 dark:text-slate-100';
  return (
    <Card className="text-center">
      <div className={'text-2xl font-bold ' + toneClass}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </Card>
  );
}

function ScanPanel({
  onCode,
  pending,
  lastResult,
}: {
  onCode: (code: string) => void;
  pending: boolean;
  lastResult: { kind: ScanResult['result']; text: string } | null;
}) {
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Debounce repeat reads of the same code from the live camera.
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  useEffect(() => {
    if (!scanning) return;
    const html5 = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = html5;
    let stopped = false;

    const start = async () => {
      try {
        await html5.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (stopped) return;
            const code = parseScannedValue(decodedText);
            if (!code) return;
            const now = Date.now();
            if (lastScanRef.current.code === code && now - lastScanRef.current.at < 2500) return;
            lastScanRef.current = { code, at: now };
            onCode(code);
          },
          () => {
            // ignore per-frame decode failures
          },
        );
      } catch (err) {
        setError((err as Error).message || 'Kameru nelze otevřít.');
        setScanning(false);
      }
    };
    void start();

    return () => {
      stopped = true;
      if (html5.isScanning) void html5.stop().catch(() => {});
    };
  }, [scanning, onCode]);

  const resultClass =
    lastResult?.kind === 'found'
      ? 'bg-emerald-100 text-emerald-800'
      : lastResult?.kind === 'already'
        ? 'bg-slate-100 text-slate-700'
        : 'bg-amber-100 text-amber-800';

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Skenovat</h2>
        <Button variant={scanning ? 'secondary' : 'primary'} onClick={() => setScanning((s) => !s)}>
          {scanning ? 'Zastavit kameru' : 'Spustit kameru'}
        </Button>
      </div>

      {scanning && (
        <div
          id={SCANNER_ELEMENT_ID}
          className="w-full max-w-sm mx-auto aspect-square bg-slate-100 rounded"
        />
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const code = parseScannedValue(manual);
          if (!code) {
            setError('Neplatný formát kódu');
            return;
          }
          setError(null);
          onCode(code);
          setManual('');
        }}
        className="flex gap-2"
      >
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="LAP-00001"
          className="font-mono"
        />
        <Button type="submit" disabled={pending}>
          Přidat
        </Button>
      </form>

      {lastResult && (
        <div className={'text-sm rounded px-3 py-2 font-medium ' + resultClass}>
          {lastResult.text}
        </div>
      )}
    </Card>
  );
}

function AssetGroup({
  title,
  hint,
  assets,
  locationLabel,
  emptyText,
  canWrite,
  onMarkFound,
  onSaveNote,
}: {
  title: string;
  hint?: string;
  assets: InventoryReportAsset[];
  locationLabel: (id: string | null) => string;
  emptyText: string;
  canWrite: boolean;
  onMarkFound?: (code: string) => void;
  onSaveNote?: (assetId: string, note: string) => void;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
        {title} ({assets.length})
      </h2>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {assets.length === 0 ? (
        <p className="text-sm text-slate-400">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
          {assets.map((a) => (
            <ReportItem
              key={a.id}
              asset={a}
              locationLabel={locationLabel}
              canWrite={canWrite}
              onMarkFound={onMarkFound}
              onSaveNote={onSaveNote}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportItem({
  asset,
  locationLabel,
  canWrite,
  onMarkFound,
  onSaveNote,
}: {
  asset: InventoryReportAsset;
  locationLabel: (id: string | null) => string;
  canWrite: boolean;
  onMarkFound?: (code: string) => void;
  onSaveNote?: (assetId: string, note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(asset.note ?? '');

  return (
    <li className="p-2.5 text-sm space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/a/${asset.code}`} className="hover:underline min-w-0 truncate">
          <span className="font-mono">{asset.code}</span> — {asset.name}
        </Link>
        <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
          <span className="hidden sm:inline">{locationLabel(asset.locationId)}</span>
          <StatusBadge status={asset.status} />
          {onMarkFound && (
            <Button
              variant="secondary"
              className="text-xs py-0.5"
              onClick={() => onMarkFound(asset.code)}
            >
              Nalezeno
            </Button>
          )}
          {canWrite && onSaveNote && (
            <button
              type="button"
              onClick={() => {
                setDraft(asset.note ?? '');
                setEditing((v) => !v);
              }}
              className="rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-700"
              title={asset.note ? 'Upravit poznámku' : 'Přidat poznámku'}
              aria-label="Poznámka k položce"
            >
              📝
            </button>
          )}
        </div>
      </div>

      {asset.note && !editing && (
        <p className="text-xs text-slate-500 dark:text-slate-400">📝 {asset.note}</p>
      )}

      {editing && onSaveNote && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Poznámka k položce…"
            className="text-xs"
          />
          <Button
            className="text-xs"
            onClick={() => {
              onSaveNote(asset.id, draft);
              setEditing(false);
            }}
          >
            Uložit
          </Button>
        </div>
      )}
    </li>
  );
}
