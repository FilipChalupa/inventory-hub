import { useState } from 'react';
import { errorMessage } from '../lib/errors.js';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient, type ImportPreviewRow, type ImportResult } from '../lib/api.js';
import { Button, Card, Select } from '../components/ui.js';
import { useT } from '../i18n/index.js';

type Kind = 'assets' | 'asset-types' | 'locations';

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
  const t = useT();
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
      setError(errorMessage(err));
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
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const headers = preview && preview.length > 0 ? Object.keys(preview[0]!.input) : [];

  return (
    <section className="space-y-4">
      <Link to="/assets" className="text-sm text-slate-500 hover:underline">
        ← {t.common.back}
      </Link>
      <h1 className="text-2xl font-bold">{t.importAssets.title}</h1>

      <Card>
        <div className="flex flex-wrap gap-2 items-end mb-3">
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t.importAssets.entity}</span>
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
              {(Object.keys(t.importAssets.kindLabels) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {t.importAssets.kindLabels[k]}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
          {t.importAssets.kindHints[kind]} {t.importAssets.limitPrefix}{' '}
          {t.importAssets.kindLimits[kind]}.
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
            {busy ? t.importAssets.working : t.importAssets.dryRun}
          </Button>
          <Button
            variant="primary"
            onClick={runCommit}
            disabled={!file || busy || (preview !== null && hasErrors)}
          >
            {t.importAssets.import}
          </Button>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        {createdCount !== null && (
          <p className="text-sm text-green-700 dark:text-green-400 mt-2">
            {t.importAssets.imported(createdCount)}{' '}
            <button className="underline" onClick={() => navigate(KIND_REDIRECT[kind])}>
              {t.importAssets.goToList}
            </button>
          </p>
        )}
      </Card>

      {preview && (
        <Card>
          <h2 className="font-semibold mb-2">
            {t.importAssets.previewTitle(preview.length)}
            {hasErrors
              ? t.importAssets.previewWithErrors(
                  preview.filter((p) => p.issues.length > 0).length,
                )
              : ''}
            {t.importAssets.previewClose}
          </h2>
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="text-left border-b border-slate-200 dark:border-slate-700">
                  <th className="py-1 pr-3">#</th>
                  {kind === 'assets' && <th className="py-1 pr-3">{t.importAssets.colCode}</th>}
                  {headers.map((h) => (
                    <th key={h} className="py-1 pr-3">
                      {h}
                    </th>
                  ))}
                  <th className="py-1">{t.importAssets.colIssues}</th>
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
                      <td className="py-1 pr-3 font-mono text-xs">
                        {p.code ?? t.importAssets.emptyValue}
                      </td>
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
