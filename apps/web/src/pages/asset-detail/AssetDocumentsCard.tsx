import { useState } from 'react';
import { errorMessage } from '../../lib/errors.js';
import { apiClient, uploadFile } from '../../lib/api.js';
import { Button, Card } from '../../components/ui.js';
import { confirm } from '../../components/ConfirmDialog.js';
import { useT } from '../../i18n/index.js';

export function AssetDocumentsCard({
  code,
  documents,
  emphasis,
  onChanged,
}: {
  code: string;
  documents: string[];
  emphasis: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const res = await uploadFile(file);
        await apiClient.assets.addDocument(code, res.path);
      }
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function remove(path: string) {
    if (
      !(await confirm({
        title: t.assetDetail.removeDocumentTitle,
        confirmLabel: t.assetDetail.remove,
        danger: true,
      }))
    )
      return;
    try {
      await apiClient.assets.removeDocument(code, path);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card className={emphasis ? 'border-amber-300 dark:border-amber-700' : undefined}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">
          {t.assetDetail.documentsHeading}
          {emphasis && (
            <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
              {t.assetDetail.documentsArchivedHint}
            </span>
          )}
        </h2>
        <label className="inline-flex items-center text-xs cursor-pointer text-blue-600 hover:underline">
          {t.assetDetail.upload}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      </div>
      {uploading && <p className="text-xs text-slate-500">{t.assetDetail.uploading}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {documents.length === 0 ? (
        <p className="text-sm text-slate-500">{t.assetDetail.noDocuments}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {documents.map((p) => {
            const isPdf = p.toLowerCase().endsWith('.pdf');
            const name = p.split('/').pop() ?? p;
            return (
              <li key={p} className="flex items-center justify-between py-1.5 text-sm">
                <a
                  href={`/api/uploads/${p}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline truncate min-w-0"
                >
                  {isPdf ? '📄' : '🖼️'} {name}
                </a>
                <Button variant="ghost" className="text-red-600 text-xs" onClick={() => remove(p)}>
                  {t.assetDetail.remove}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
