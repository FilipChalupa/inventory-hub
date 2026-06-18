import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card } from '../components/ui.js';
import { parseScannedValue } from '../lib/scan.js';

const SCANNER_ELEMENT_ID = 'qr-scanner-region';

export function ScanPage() {
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [scanning, setScanning] = useState(false);

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
        setError(
          (err as Error).message ||
            'Kameru nelze otevřít — povol přístup nebo zadej kód ručně.',
        );
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
      setError('Neplatný formát kódu');
      return;
    }
    navigate(`/a/${code}`);
  };

  return (
    <section className="space-y-4">
      <Link to="/assets" className="text-sm text-slate-500 hover:underline">
        ← zpět na seznam
      </Link>
      <h1 className="text-2xl font-bold">Skenovat QR</h1>

      <Card>
        <div
          id={SCANNER_ELEMENT_ID}
          className="w-full max-w-md mx-auto aspect-square bg-slate-100 rounded"
        />
        {!scanning && !error && (
          <p className="text-sm text-slate-500 text-center mt-3">
            Inicializuji kameru…
          </p>
        )}
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </Card>

      <Card>
        <h2 className="font-semibold mb-2">Ruční zadání</h2>
        <form onSubmit={submitManual} className="flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="LAP-00001"
            className="flex-1 border rounded px-2 py-1 font-mono"
          />
          <Button type="submit">Otevřít</Button>
        </form>
      </Card>
    </section>
  );
}
