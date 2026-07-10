import { useState } from 'react';
import { errorMessage } from '../../lib/errors.js';
import { apiClient, uploadFile } from '../../lib/api.js';
import { Card } from '../../components/ui.js';
import { confirm } from '../../components/ConfirmDialog.js';
import { useT } from '../../i18n/index.js';

export function AssetPhotosCard({
  code,
  photos,
  onChanged,
}: {
  code: string;
  photos: string[];
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
        await apiClient.assets.addPhoto(code, res.path);
      }
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(path: string) {
    if (
      !(await confirm({
        title: t.assetDetail.removePhotoTitle,
        confirmLabel: t.assetDetail.remove,
        danger: true,
      }))
    )
      return;
    try {
      await apiClient.assets.removePhoto(code, path);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">{t.assetDetail.photosHeading}</h2>
        <label className="inline-flex items-center text-xs cursor-pointer text-blue-600 hover:underline">
          {t.assetDetail.upload}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      </div>
      {uploading && <p className="text-xs text-slate-500">{t.assetDetail.uploading}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {photos.length === 0 ? (
        <p className="text-sm text-slate-500">{t.assetDetail.noPhotos}</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {photos.map((p) => (
            <div
              key={p}
              className="relative w-24 h-24 rounded border overflow-hidden bg-slate-50 group"
            >
              <a
                href={`/api/uploads/${p}`}
                target="_blank"
                rel="noreferrer"
                className="block w-full h-full"
              >
                <img src={`/api/uploads/${p}`} alt="" className="w-full h-full object-cover" />
              </a>
              <button
                type="button"
                onClick={() => removePhoto(p)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 text-slate-700 text-xs leading-none border opacity-0 group-hover:opacity-100"
                aria-label={t.assetDetail.remove}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
