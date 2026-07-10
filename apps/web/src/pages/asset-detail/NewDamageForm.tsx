import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { errorMessage } from '../../lib/errors.js';
import { uploadFile } from '../../lib/api.js';
import { Button, Card, Field, Input, Select, Textarea } from '../../components/ui.js';
import { MAX_DAMAGE_PHOTOS, type DamageSeverity } from '@inventory-hub/shared';
import { useT } from '../../i18n/index.js';

export function NewDamageForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (v: {
    occurredAt: Date;
    description: string;
    severity: DamageSeverity;
    photoPaths: string[];
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 16);
  const { register, handleSubmit, formState } = useForm<{
    occurredAt: string;
    description: string;
    severity: DamageSeverity;
  }>({
    defaultValues: { occurredAt: today, description: '', severity: 'minor' },
  });
  const [photos, setPhotos] = useState<{ path: string; previewUrl: string }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    const remaining = MAX_DAMAGE_PHOTOS - photos.length;
    if (remaining <= 0) {
      setUploadError(t.assetDetail.maxPhotos(MAX_DAMAGE_PHOTOS));
      return;
    }
    const slice = Array.from(files).slice(0, remaining);
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        slice.map(async (file) => {
          const res = await uploadFile(file);
          return { path: res.path, previewUrl: URL.createObjectURL(file) };
        }),
      );
      setPhotos((prev) => [...prev, ...uploaded]);
      if (files.length > slice.length) {
        setUploadError(t.assetDetail.someNotUploaded(MAX_DAMAGE_PHOTOS));
      }
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (v) => {
          setSubmitError(null);
          setSaving(true);
          try {
            await onSubmit({
              ...v,
              occurredAt: new Date(v.occurredAt),
              photoPaths: photos.map((p) => p.path),
            });
          } catch (err) {
            setSubmitError(errorMessage(err));
          } finally {
            setSaving(false);
          }
        })}
      >
        <Field
          label={t.assetDetail.damageWhenLabel}
          required
          error={formState.errors.occurredAt ? t.assetDetail.damageWhenRequired : undefined}
        >
          <Input type="datetime-local" {...register('occurredAt', { required: true })} />
        </Field>
        <Field
          label={t.assetDetail.damageDescriptionLabel}
          required
          error={formState.errors.description ? t.assetDetail.damageDescriptionRequired : undefined}
        >
          <Textarea rows={3} {...register('description', { required: true })} />
        </Field>
        <Field label={t.assetDetail.severityHeadingLabel}>
          <Select {...register('severity')}>
            <option value="minor">{t.assetDetail.severityMinor}</option>
            <option value="major">{t.assetDetail.severityMajor}</option>
            <option value="total">{t.assetDetail.severityTotal}</option>
          </Select>
        </Field>
        <Field label={t.assetDetail.photosOptionalLabel}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-slate-100 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
        </Field>
        {photos.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {photos.map((p, idx) => (
              <div
                key={p.path}
                className="relative w-20 h-20 rounded border overflow-hidden bg-slate-50"
              >
                <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white/90 text-slate-700 text-xs leading-none border"
                  aria-label={t.assetDetail.remove}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {uploading && <p className="text-xs text-slate-500">{t.assetDetail.uploadingPhotos}</p>}
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={uploading || saving}>
            {saving ? t.common.saving : t.assetDetail.record}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t.common.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
