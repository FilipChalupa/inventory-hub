import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { errorMessage } from '../lib/errors.js';
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
import {
  Button,
  Card,
  Input,
  SkeletonList,
  StatusBadge,
  Textarea,
  formatDate,
} from '../components/ui.js';
import { confirm } from '../components/ConfirmDialog.js';
import { toast } from '../components/Toast.js';
import { locationPath } from '../lib/locations.js';
import { classifyScan } from '../lib/scan.js';
import { isNetworkError, scanQueue } from '../lib/scanQueue.js';
import { hasRole, useCurrentUser } from '../auth/AuthContext.js';
import { useT } from '../i18n/index.js';

const SCANNER_ELEMENT_ID = 'inventory-scanner-region';

type Detail = { session: InventorySessionRow; report: InventoryReport };

export function InventorySessionPage() {
  const t = useT();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const canWrite = hasRole(useCurrentUser(), 'admin', 'operator');

  const [lastResult, setLastResult] = useState<{
    kind: ScanResult['result'] | 'queued';
    text: string;
  } | null>(null);
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
    queryClient.setQueryData<Detail>(['inventory', id], (old) =>
      old ? { ...old, report: next } : old,
    );
  const applyReportRef = useRef(applyReport);
  applyReportRef.current = applyReport;

  const queue = useSyncExternalStore(scanQueue.subscribe, () => scanQueue.get(id));

  // Offline → queue the scan locally; it is sent by the flusher below.
  const queueScan = (code: string) => {
    const added = scanQueue.enqueue(id, code);
    setLastResult({
      kind: 'queued',
      text: added ? t.inventorySession.queuedOffline(code) : t.inventorySession.alreadyQueued(code),
    });
  };

  // Sends queued scans one by one, oldest first. Stops at the first network
  // failure (still offline); a refusal from the server is parked as failed.
  const flushing = useRef(false);
  const flushQueue = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const item of scanQueue.get(id).pending) {
        try {
          const res = await apiClient.inventory.scan(id, item.code, item.scannedAt);
          scanQueue.done(id, item.id);
          applyReportRef.current(res.report);
        } catch (err) {
          if (isNetworkError(err)) break;
          scanQueue.fail(id, item.id, errorMessage(err));
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [id]);

  const pendingCount = queue.pending.length;
  useEffect(() => {
    if (pendingCount === 0) return;
    void flushQueue();
    const onOnline = () => void flushQueue();
    window.addEventListener('online', onOnline);
    // Retry periodically too: `online` isn't reliable on flaky Wi-Fi.
    const timer = setInterval(() => void flushQueue(), 20_000);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, [pendingCount, flushQueue]);

  const scan = useMutation({
    // Default 'online' mode would *pause* the mutation while offline; we want
    // it to fail fast so onError can queue the scan.
    networkMode: 'always',
    mutationFn: async (code: string) => {
      // Known offline → don't wait for a doomed request; onError queues it.
      if (!navigator.onLine) throw new TypeError('offline');
      return apiClient.inventory.scan(id, code);
    },
    onSuccess: (res) => {
      const label = `${res.asset.code} — ${res.asset.name}`;
      setLastResult({
        kind: res.result,
        text:
          res.result === 'found'
            ? t.inventorySession.scanFound(label)
            : res.result === 'already'
              ? t.inventorySession.scanAlready(label)
              : t.inventorySession.scanUnexpected(label),
      });
      applyReport(res.report);
    },
    onError: (e: unknown, code) => {
      if (isNetworkError(e)) {
        queueScan(code);
        return;
      }
      setLastResult({
        kind: 'unexpected',
        text: e instanceof Error ? e.message : t.inventorySession.scanError,
      });
    },
  });

  const itemNote = useMutation({
    mutationFn: (v: { assetId: string; note: string }) =>
      apiClient.inventory.setItemNote(id, v.assetId, v.note),
    onSuccess: (res) => applyReport(res.report),
    onError: (e: unknown) =>
      setActionError(e instanceof Error ? e.message : t.inventorySession.genericError),
  });

  const saveSessionNote = useMutation({
    mutationFn: (note: string) =>
      apiClient.inventory.update(id, { note: note.trim() ? note.trim() : null }),
    onSuccess: (_res, note) =>
      queryClient.setQueryData<Detail>(['inventory', id], (old) =>
        old ? { ...old, session: { ...old.session, note: note.trim() ? note.trim() : null } } : old,
      ),
    onError: (e: unknown) =>
      setActionError(e instanceof Error ? e.message : t.inventorySession.genericError),
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
    onError: (e: unknown) =>
      setActionError(e instanceof Error ? e.message : t.inventorySession.genericError),
  });
  const reopen = useMutation({
    mutationFn: () => apiClient.inventory.reopen(id),
    onSuccess: () => setStatus('open'),
    onError: (e: unknown) =>
      setActionError(e instanceof Error ? e.message : t.inventorySession.genericError),
  });
  const markLost = useMutation({
    mutationFn: (codes: string[]) => apiClient.inventory.markLost(id, codes),
    onSuccess: (res) => {
      applyReport(res.report);
      void queryClient.invalidateQueries({ queryKey: ['inventory'], exact: true });
    },
    onError: (e: unknown) =>
      setActionError(e instanceof Error ? e.message : t.inventorySession.genericError),
  });

  const locationLabel = (locId: string | null) =>
    locId ? locationPath(locations.data?.items ?? [], locId) || '—' : '—';

  if (detail.isLoading) return <SkeletonList rows={5} />;
  if (detail.error || !session || !report) {
    return (
      <section className="space-y-3">
        <Link to="/inventory" className="inline-block text-sm text-slate-500 hover:underline">
          {t.inventorySession.backToInventories}
        </Link>
        <p className="text-sm text-red-600">
          {detail.error ? errorMessage(detail.error) : t.inventorySession.notFound}
        </p>
      </section>
    );
  }

  const scopeLabel =
    session.assetIds && session.assetIds.length > 0
      ? t.inventorySession.scopeManual(session.assetIds.length)
      : [
          session.locationId
            ? locationLabel(session.locationId)
            : t.inventorySession.scopeWholeOrganization,
          session.typeIds && session.typeIds.length > 0
            ? t.inventorySession.scopeTypes(session.typeIds.length)
            : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const onSaveNote = canWrite
    ? (assetId: string, note: string) => itemNote.mutate({ assetId, note })
    : undefined;

  return (
    <section className="space-y-4">
      <Link
        to="/inventory"
        className="inline-block text-sm text-slate-500 hover:underline print:hidden"
      >
        {t.inventorySession.backToInventories}
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{session.name}</h1>
          <p className="text-sm text-slate-500">
            {t.inventorySession.scopePrefix(scopeLabel)} ·{' '}
            {t.inventorySession.createdAt(formatDate(session.createdAt))}
            {session.status === 'closed' && session.closedAt
              ? ` · ${t.inventorySession.closedAt(formatDate(session.closedAt))}`
              : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={
              'text-xs px-2 py-0.5 rounded-sm font-medium ' +
              (isOpen ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')
            }
          >
            {isOpen ? t.inventorySession.statusOpen : t.inventorySession.statusClosed}
          </span>
          <div className="flex gap-2 print:hidden">
            <a
              href={`/api/inventory/${encodeURIComponent(id)}/report.csv`}
              className="inline-flex items-center rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
            >
              {t.inventorySession.exportCsv}
            </a>
            <Button variant="secondary" onClick={() => window.print()}>
              {t.inventorySession.printPdf}
            </Button>
          </div>
        </div>
      </div>
      <p className="hidden print:block text-xs text-slate-500">
        {t.inventorySession.printedAt(formatDate(new Date().toISOString()))}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label={t.inventorySession.statExpected} value={report.counts.expected} />
        <Stat label={t.inventorySession.statFound} value={report.counts.found} tone="emerald" />
        <Stat label={t.inventorySession.statMissing} value={report.counts.missing} tone="red" />
        <Stat
          label={t.inventorySession.statUnexpected}
          value={report.counts.unexpected}
          tone="amber"
        />
      </div>

      <SessionNote
        note={session.note}
        canWrite={canWrite}
        saving={saveSessionNote.isPending}
        onSave={(note) => saveSessionNote.mutate(note)}
      />

      {canWrite && isOpen && (
        <div className="print:hidden">
          <ScanPanel
            onCode={(code) => scan.mutate(code)}
            pending={scan.isPending}
            lastResult={lastResult}
          />
        </div>
      )}

      {pendingCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <span role="status">{t.inventorySession.queuePending(pendingCount)}</span>
          <Button variant="secondary" className="text-xs" onClick={() => void flushQueue()}>
            {t.inventorySession.queueSyncNow}
          </Button>
        </div>
      )}
      {queue.failed.length > 0 && (
        <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 print:hidden dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-medium">{t.inventorySession.queueFailedTitle}</p>
          <ul className="my-1 list-inside list-disc">
            {queue.failed.map((f) => (
              <li key={f.id}>
                <span className="font-mono">{f.code}</span> — {f.error}
              </li>
            ))}
          </ul>
          <Button variant="ghost" className="text-xs" onClick={() => scanQueue.clearFailed(id)}>
            {t.inventorySession.queueFailedDismiss}
          </Button>
        </div>
      )}

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {isOpen ? (
            <Button variant="secondary" onClick={() => close.mutate()} disabled={close.isPending}>
              {t.inventorySession.closeInventory}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              {t.inventorySession.reopen}
            </Button>
          )}
          {report.missing.length > 0 && (
            <Button
              variant="danger"
              disabled={markLost.isPending}
              onClick={async () => {
                const losable = report.missing.filter((m) => m.status !== 'on_loan');
                if (losable.length === 0) return;
                if (
                  await confirm({
                    title: t.inventorySession.markLostTitle(losable.length),
                    message: t.inventorySession.markLostMessage,
                    confirmLabel: t.inventorySession.markLostConfirm,
                    danger: true,
                  })
                ) {
                  markLost.mutate(
                    losable.map((m) => m.code),
                    {
                      onSuccess: () => toast.success(t.inventorySession.markLostSuccess),
                    },
                  );
                }
              }}
            >
              {t.inventorySession.markMissingLost}
            </Button>
          )}
        </div>
      )}

      <AssetGroup
        title={t.inventorySession.groupMissingTitle}
        hint={t.inventorySession.groupMissingHint}
        assets={report.missing}
        locationLabel={locationLabel}
        emptyText={t.inventorySession.groupMissingEmpty}
        canWrite={canWrite}
        onSaveNote={onSaveNote}
        onMarkFound={canWrite && isOpen ? (code) => scan.mutate(code) : undefined}
      />
      <AssetGroup
        title={t.inventorySession.groupUnexpectedTitle}
        hint={t.inventorySession.groupUnexpectedHint}
        assets={report.unexpected}
        locationLabel={locationLabel}
        emptyText={t.inventorySession.groupUnexpectedEmpty}
        canWrite={canWrite}
        onSaveNote={onSaveNote}
      />
      <AssetGroup
        title={t.inventorySession.groupFoundTitle}
        assets={report.found}
        locationLabel={locationLabel}
        emptyText={t.inventorySession.groupFoundEmpty}
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
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? '');

  if (!canWrite) {
    if (!note) return null;
    return (
      <Card>
        <h2 className="font-semibold mb-1 text-sm">{t.inventorySession.noteHeading}</h2>
        <p className="text-sm whitespace-pre-wrap">{note}</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">{t.inventorySession.noteHeadingEditable}</h2>
        {!editing && (
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() => {
              setDraft(note ?? '');
              setEditing(true);
            }}
          >
            {note ? t.common.edit : t.common.add}
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
              {saving ? t.inventorySession.saving : t.common.save}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : note ? (
        <p className="text-sm whitespace-pre-wrap">{note}</p>
      ) : (
        <p className="text-sm text-slate-400">{t.inventorySession.noteEmpty}</p>
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
  lastResult: { kind: ScanResult['result'] | 'queued'; text: string } | null;
}) {
  const t = useT();
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Debounce repeat reads of the same code from the live camera.
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  // Read the locale-dependent camera-error label via a ref so a language
  // switch doesn't restart the camera effect.
  const cameraErrorRef = useRef(t.inventorySession.cameraError);
  cameraErrorRef.current = t.inventorySession.cameraError;

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
            // Our QR → its code; anything else (serial/EAN barcode) is sent
            // as-is and resolved by the server's identifier lookup.
            const target = classifyScan(decodedText);
            if (!target) return;
            const code = target.kind === 'code' ? target.code : target.value;
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
        setError(errorMessage(err) || cameraErrorRef.current);
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
        <h2 className="font-semibold">{t.inventorySession.scanHeading}</h2>
        <Button variant={scanning ? 'secondary' : 'primary'} onClick={() => setScanning((s) => !s)}>
          {scanning ? t.inventorySession.stopCamera : t.inventorySession.startCamera}
        </Button>
      </div>

      {scanning && (
        <div
          id={SCANNER_ELEMENT_ID}
          className="w-full max-w-sm mx-auto aspect-square bg-slate-100 rounded-sm"
        />
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const target = classifyScan(manual);
          const code = target && (target.kind === 'code' ? target.code : target.value);
          if (!code) {
            setError(t.inventorySession.invalidCodeFormat);
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
          placeholder={t.inventorySession.manualPlaceholder}
          className="font-mono"
        />
        <Button type="submit" disabled={pending}>
          {t.common.add}
        </Button>
      </form>

      {lastResult && (
        <div className={'text-sm rounded-sm px-3 py-2 font-medium ' + resultClass}>
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
  const t = useT();
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
        {title} {t.inventorySession.groupCount(assets.length)}
      </h2>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {assets.length === 0 ? (
        <p className="text-sm text-slate-400">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-sm border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
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
  const t = useT();
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
              {t.inventorySession.markFound}
            </Button>
          )}
          {canWrite && onSaveNote && (
            <button
              type="button"
              onClick={() => {
                setDraft(asset.note ?? '');
                setEditing((v) => !v);
              }}
              className="rounded-sm px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-700"
              title={
                asset.note ? t.inventorySession.editNoteTitle : t.inventorySession.addNoteTitle
              }
              aria-label={t.inventorySession.itemNoteAriaLabel}
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
            placeholder={t.inventorySession.itemNotePlaceholder}
            className="text-xs"
          />
          <Button
            className="text-xs"
            onClick={() => {
              onSaveNote(asset.id, draft);
              setEditing(false);
            }}
          >
            {t.common.save}
          </Button>
        </div>
      )}
    </li>
  );
}
