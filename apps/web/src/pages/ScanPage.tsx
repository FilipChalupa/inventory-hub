import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/errors.js';
import { Html5Qrcode } from 'html5-qrcode';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card } from '../components/ui.js';
import { parseScannedValue } from '../lib/scan.js';
import { useT } from '../i18n/index.js';

const SCANNER_ELEMENT_ID = 'qr-scanner-region';

export function ScanPage() {
  const t = useT();
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [scanning, setScanning] = useState(false);

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
            const code = parseScannedValue(decodedText);
            if (!code) return;
            stopped = true;
            void html5.stop().finally(() => navigate(`/a/${code}`));
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
  }, [navigate]);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const code = parseScannedValue(manualCode);
    if (!code) {
      setError(t.scan.invalidCode);
      return;
    }
    navigate(`/a/${code}`);
  };

  return (
    <section className="space-y-4">
      <Link to="/assets" className="text-sm text-slate-500 hover:underline">
        {t.scan.backToList}
      </Link>
      <h1 className="text-2xl font-bold">{t.scan.title}</h1>

      <Card>
        <div
          id={SCANNER_ELEMENT_ID}
          className="w-full max-w-md mx-auto aspect-square bg-slate-100 rounded"
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
            placeholder="LAP-00001"
            className="flex-1 border rounded px-2 py-1 font-mono"
          />
          <Button type="submit">{t.scan.open}</Button>
        </form>
      </Card>
    </section>
  );
}
