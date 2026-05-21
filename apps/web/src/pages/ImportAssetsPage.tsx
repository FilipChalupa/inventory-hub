import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { Button, Card } from '../components/ui.js';

type Preview = {
  lineNumber: number;
  input: Record<string, string>;
  code: string | null;
  issues: string[];
};

export function ImportAssetsPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [hasErrors, setHasErrors] = useState(false);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDryRun() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setCreatedCount(null);
    try {
      const res = await apiClient.assets.import(file, true);
      setPreview(res.preview);
      setHasErrors(res.hasErrors);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.assets.import(file, false);
      setPreview(res.preview);
      setHasErrors(res.hasErrors);
      setCreatedCount(res.created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const headers = preview && preview.length > 0 ? Object.keys(preview[0]!.input) : [];

  return (
    <section className="space-y-4">
      <Link to="/" className="text-sm text-slate-500 hover:underline">
        ← zpět na seznam
      </Link>
      <h1 className="text-2xl font-bold">Import assetů z CSV</h1>

      <Card>
        <p className="text-sm text-slate-600 mb-3">
          CSV s hlavičkou. Povinný sloupec: <code>name</code>. Volitelně{' '}
          <code>code</code> (jinak se vygeneruje z prefixu typu), <code>type</code> (codePrefix
          existujícího typu), <code>notes</code>. Další sloupce se interpretují jako vlastní pole.
          Max 1000 řádků, 1 MB.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setCreatedCount(null);
            setError(null);
          }}
          className="block text-sm"
        />
        <div className="mt-3 flex gap-2">
          <Button onClick={runDryRun} disabled={!file || busy}>
            {busy ? 'Pracuji…' : 'Náhled (dry-run)'}
          </Button>
          <Button
            variant="primary"
            onClick={runCommit}
            disabled={!file || busy || (preview !== null && hasErrors)}
          >
            Importovat
          </Button>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        {createdCount !== null && (
          <p className="text-sm text-green-700 mt-2">
            Importováno {createdCount} assetů.{' '}
            <button className="underline" onClick={() => navigate('/')}>
              Přejít na seznam
            </button>
          </p>
        )}
      </Card>

      {preview && (
        <Card>
          <h2 className="font-semibold mb-2">
            Náhled ({preview.length} řádků
            {hasErrors ? `, ${preview.filter((p) => p.issues.length > 0).length} s chybami` : ''})
          </h2>
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1 pr-3">#</th>
                  <th className="py-1 pr-3">code</th>
                  {headers.map((h) => (
                    <th key={h} className="py-1 pr-3">
                      {h}
                    </th>
                  ))}
                  <th className="py-1">problémy</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr
                    key={p.lineNumber}
                    className={p.issues.length > 0 ? 'bg-red-50' : ''}
                  >
                    <td className="py-1 pr-3 text-slate-400">{p.lineNumber}</td>
                    <td className="py-1 pr-3 font-mono text-xs">{p.code ?? '—'}</td>
                    {headers.map((h) => (
                      <td key={h} className="py-1 pr-3">
                        {p.input[h]}
                      </td>
                    ))}
                    <td className="py-1 text-xs text-red-700">
                      {p.issues.join('; ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}
