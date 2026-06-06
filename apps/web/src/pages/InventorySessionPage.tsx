import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { apiClient, type InventoryReportAsset, type ScanResult } from '../lib/api.js';
import { Button, Card, Input, StatusBadge, formatDate } from '../components/ui.js';
import { locationPath } from '../lib/locations.js';
import { parseScannedValue } from '../lib/scan.js';
import { hasRole, useCurrentUser } from '../auth/AuthContext.js';

const SCANNER_ELEMENT_ID = 'inventory-scanner-region';

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
      void queryClient.invalidateQueries({ queryKey: ['inventory', id] });
    },
    onError: (e: unknown) =>
      setLastResult({ kind: 'unexpected', text: e instanceof Error ? e.message : 'Chyba skenu' }),
  });

  const close = useMutation({
    mutationFn: () => apiClient.inventory.close(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : 'Chyba'),
  });
  const reopen = useMutation({
    mutationFn: () => apiClient.inventory.reopen(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    onError: (e: unknown) => setActionError(e instanceof Error ? e.message : 'Chyba'),
  });
  const markLost = useMutation({
    mutationFn: (codes: string[]) => apiClient.inventory.markLost(id, codes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
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

  return (
    <section className="space-y-4">
      <Link to="/inventory" className="text-sm text-slate-500 hover:underline">
        ← zpět na inventury
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{session.name}</h1>
          <p className="text-sm text-slate-500">
            Rozsah: {session.locationId ? locationLabel(session.locationId) : 'celá organizace'} ·
            založeno {formatDate(session.createdAt)}
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
            <Button
              variant="secondary"
              onClick={() => close.mutate()}
              disabled={close.isPending}
            >
              Uzavřít inventuru
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => reopen.mutate()}
              disabled={reopen.isPending}
            >
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
      />
      <AssetGroup
        title="Navíc / mimo rozsah"
        hint="Naskenováno, ale nepatří do očekávaného rozsahu (archivováno nebo na jiné lokaci)."
        assets={report.unexpected}
        locationLabel={locationLabel}
        emptyText="Nic navíc."
      />
      <AssetGroup
        title="Nalezeno"
        assets={report.found}
        locationLabel={locationLabel}
        emptyText="Zatím nic naskenováno."
      />
    </section>
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
}: {
  title: string;
  hint?: string;
  assets: InventoryReportAsset[];
  locationLabel: (id: string | null) => string;
  emptyText: string;
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
            <li key={a.id} className="flex items-center justify-between p-2.5 gap-3 text-sm">
              <Link to={`/a/${a.code}`} className="hover:underline">
                <span className="font-mono">{a.code}</span> — {a.name}
              </Link>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{locationLabel(a.locationId)}</span>
                <StatusBadge status={a.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
