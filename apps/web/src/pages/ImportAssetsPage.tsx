import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient, type ImportPreviewRow, type ImportResult } from '../lib/api.js';
import { Button, Card, Select } from '../components/ui.js';

type Kind = 'assets' | 'asset-types' | 'locations';

const KIND_LABELS: Record<Kind, string> = {
  assets: 'Assety',
  'asset-types': 'Typy assetů',
  locations: 'Lokace',
};

const KIND_HINTS: Record<Kind, string> = {
  assets:
    'Povinný: name. Volitelné: code, type (codePrefix existujícího typu), notes. Další sloupce = vlastní pole.',
  'asset-types': 'Povinné: name, code_prefix.',
  locations:
    'Povinný: name. Volitelné: parent_name (musí odpovídat jménu existující lokace).',
};

const KIND_LIMITS: Record<Kind, string> = {
  assets: '1 MB, max 1000 řádků',
  'asset-types': '100 KB, max 200 řádků',
  locations: '100 KB, max 500 řádků',
};

const KIND_REDIRECT: Record<Kind, string> = {
  assets: '/',
  'asset-types': '/asset-types',
  locations: '/locations',
};

function runImport(kind: Kind, file: File, dryRun: boolean): Promise<ImportResult> {
  switch (kind) {
    case 'assets':
      return apiClient.assets.import(file, dryRun);
    case 'asset-types':
      return apiClient.assetTypes.import(file, dryRun);
    case 'locations':
      return apiClient.locations.import(file, dryRun);
  }
}

export function ImportAssetsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialKind = (params.get('kind') as Kind | null) ?? 'assets';
  const [kind, setKind] = useState<Kind>(
    ['assets', 'asset-types', 'locations'].includes(initialKind) ? initialKind : 'assets',
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewRow[] | null>(null);
  const [hasErrors, setHasErrors] = useState(false);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetResult() {
    setPreview(null);
    setHasErrors(false);
    setCreatedCount(null);
    setError(null);
  }

  async function runDryRun() {
    if (!file) return;
    setBusy(true);
    resetResult();
    try {
      const res = await runImport(kind, file, true);
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
      const res = await runImport(kind, file, false);
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
      <Link to="/assets" className="text-sm text-slate-500 hover:underline">
        ← zpět
      </Link>
      <h1 className="text-2xl font-bold">Import z CSV</h1>

      <Card>
        <div className="flex flex-wrap gap-2 items-end mb-3">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Entita</span>
            <Select
              value={kind}
              onChange={(e) => {
                const next = e.target.value as Kind;
                setKind(next);
                setParams({ kind: next });
                resetResult();
                setFile(null);
              }}
            >
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
          {KIND_HINTS[kind]} Limit: {KIND_LIMITS[kind]}.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            resetResult();
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
          <p className="text-sm text-green-700 dark:text-green-400 mt-2">
            Importováno {createdCount} záznamů.{' '}
            <button className="underline" onClick={() => navigate(KIND_REDIRECT[kind])}>
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
                <tr className="text-left border-b border-slate-200 dark:border-slate-700">
                  <th className="py-1 pr-3">#</th>
                  {kind === 'assets' && <th className="py-1 pr-3">code</th>}
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
                    className={p.issues.length > 0 ? 'bg-red-50 dark:bg-red-900/30' : ''}
                  >
                    <td className="py-1 pr-3 text-slate-400">{p.lineNumber}</td>
                    {kind === 'assets' && (
                      <td className="py-1 pr-3 font-mono text-xs">{p.code ?? '—'}</td>
                    )}
                    {headers.map((h) => (
                      <td key={h} className="py-1 pr-3">
                        {p.input[h]}
                      </td>
                    ))}
                    <td className="py-1 text-xs text-red-700 dark:text-red-300">
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
