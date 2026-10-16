import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/errors.js';
import { Html5Qrcode } from 'html5-qrcode';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card } from '../components/ui.js';
import { classifyScan } from '../lib/scan.js';
import { apiClient, type AssetLookupMatch } from '../lib/api.js';
import { useT } from '../i18n/index.js';

const SCANNER_ELEMENT_ID = 'qr-scanner-region';

export function ScanPage() {
  const t = useT();
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [choices, setChoices] = useState<{
    value: string;
    items: { code: string; name: string; matchedOn: AssetLookupMatch[] }[];
  } | null>(null);

  // Our QR opens directly; anything else (typed code, serial, EAN barcode)
  // goes through the exact identifier lookup.
  const resolveRef = useRef<(raw: string) => Promise<boolean>>(async () => false);
  resolveRef.current = async (raw: string) => {
    const target = classifyScan(raw);
    if (!target) return false;
    if (target.kind === 'code') {
      navigate(`/a/${target.code}`);
      return true;
    }
    setResolving(true);
    setError(null);
    setChoices(null);
    try {
      const { items } = await apiClient.assets.lookup(target.value);
      if (items.length === 1) {
        navigate(`/a/${items[0]!.code}`);
        return true;
      }
      if (items.length === 0) {
        setError(t.scan.notFound(target.value));
        return false;
      }
      setChoices({ value: target.value, items });
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setResolving(false);
    }
  };

  // Read the (locale-dependent) camera-error label via a ref so the camera
  // effect doesn't restart the stream every time the translation object
  // changes (e.g. on a language switch).
  const cameraErrorRef = useRef(t.scan.cameraError);
  cameraErrorRef.current = t.scan.cameraError;

  useEffect(() => {
    const html5 = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = html5;
    let stopped = false;

    const start = async () => {
      try {
        await html5.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText) => {
            if (stopped) return;
            stopped = true;
            void html5.stop().finally(async () => {
              // Nothing matched: keep the camera going for another try.
              if (!(await resolveRef.current(decodedText))) {
                stopped = false;
                void start();
              }
            });
          },
          () => {
            // ignore per-frame decode failures
          },
        );
        setScanning(true);
      } catch (err) {
        setError(errorMessage(err) || cameraErrorRef.current);
      }
    };
    void start();

    return () => {
      stopped = true;
      if (html5.isScanning) {
        void html5.stop().catch(() => {
          // ignore
        });
      }
    };
  }, []);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) {
      setError(t.scan.invalidCode);
      return;
    }
    void resolveRef.current(manualCode);
  };

  const matchLabel = (m: AssetLookupMatch) =>
    m.field === 'code'
      ? t.scan.matchedCode
      : m.field === 'externalId'
        ? (m.key ?? '')
        : t.scan.matchedCustom(m.key ?? '');

  return (
    <section className="space-y-4">
      <Link to="/assets" className="inline-block text-sm text-slate-500 hover:underline">
        {t.scan.backToList}
      </Link>
      <h1 className="text-2xl font-bold">{t.scan.title}</h1>

      <Card>
        <div
          id={SCANNER_ELEMENT_ID}
          className="w-full max-w-md mx-auto aspect-square bg-slate-100 rounded-sm"
        />
        {!scanning && !error && (
          <p className="text-sm text-slate-500 text-center mt-3">{t.scan.initializing}</p>
        )}
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </Card>

      <Card>
        <h2 className="font-semibold mb-2">{t.scan.manualEntry}</h2>
        <form onSubmit={submitManual} className="flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            aria-label={t.scan.manualEntry}
            placeholder={t.scan.manualPlaceholder}
            className="flex-1 border rounded-sm px-2 py-1 font-mono"
          />
          <Button type="submit" disabled={resolving}>
            {resolving ? t.scan.resolving : t.scan.open}
          </Button>
        </form>
      </Card>

      {choices && (
        <Card>
          <p className="text-sm mb-2">{t.scan.pickOne(choices.value)}</p>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {choices.items.map((a) => (
              <li key={a.code} className="py-2">
                <Link to={`/a/${a.code}`} className="hover:underline">
                  <span className="font-mono text-xs text-slate-500">{a.code}</span> {a.name}
                </Link>
                <span className="ml-2 text-xs text-slate-500">
                  {a.matchedOn.map((m) => `${matchLabel(m)}: ${m.value}`).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
