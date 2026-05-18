'use client';

import { Loader2, Upload, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { uploadFile } from '@/lib/storage/upload';
import { getUploadPolicy, type UploadKind } from '@/lib/storage/urls';

interface Props {
  kind: UploadKind;
  /** Existing URL (null when no upload yet). Cleared via the trash button. */
  value: string | null;
  onChange: (next: {
    url: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
  }) => void;
  label: string;
}

/**
 * Direct browser-to-S3 uploader. Calls the createUploadUrl server
 * action to get a presigned PUT URL, then PUTs the selected file via
 * XMLHttpRequest with progress events. Cancels in-flight uploads on
 * dismount; cancels if the user clicks the X button.
 */
export function MediaUploader({ kind, value, onChange, label }: Props) {
  const t = useTranslations('clinical.exercises');
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const policy = getUploadPolicy(kind);
  const accept = policy.allowedContentTypes.join(',');
  const maxMb = Math.round(policy.maxSizeBytes / (1024 * 1024));

  function pickFile() {
    inputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!policy.allowedContentTypes.includes(file.type)) {
      toast.error(t('errors.unsupportedType'));
      return;
    }
    if (file.size > policy.maxSizeBytes) {
      toast.error(t('errors.tooLarge', { maxMb }));
      return;
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setProgress(0);
    try {
      const r = await uploadFile({
        kind,
        file,
        signal: abortRef.current.signal,
        onProgress: (f) => setProgress(f),
      });
      onChange({ url: r.url, mimeType: r.mimeType, sizeBytes: r.sizeBytes });
      toast.success(t('uploadDoneToast'));
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
      toast.error(
        locale === 'ar'
          ? t('errors.uploadFailed')
          : err instanceof Error
            ? err.message
            : 'Upload failed',
      );
    } finally {
      setProgress(null);
    }
  }

  function clear() {
    abortRef.current?.abort();
    onChange({ url: null, mimeType: null, sizeBytes: null });
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-brand-navy">{label}</label>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFile} />
      {value ? (
        <div className="space-y-2">
          {kind === 'exercise_image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              className="max-h-48 rounded-md border border-brand-border object-cover"
            />
          ) : (
            <video
              src={value}
              controls
              preload="metadata"
              className="max-h-64 w-full rounded-md border border-brand-border"
            >
              <track kind="captions" />
            </video>
          )}
          <Button type="button" variant="outline" size="sm" onClick={clear}>
            <X className="me-1 size-4" />
            {t('removeMedia')}
          </Button>
        </div>
      ) : progress != null ? (
        <div className="flex items-center gap-2 rounded-md border border-brand-border bg-brand-bg p-3">
          <Loader2 className="size-4 animate-spin text-brand-cyan" />
          <div className="flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-brand-border">
              <div
                className="h-full bg-brand-cyan transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-brand-textMuted">{Math.round(progress * 100)}%</p>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" onClick={pickFile}>
          <Upload className="me-2 size-4" />
          {t('uploadMedia', { maxMb })}
        </Button>
      )}
      <p className="text-xs text-brand-textMuted">
        {t('uploadHint', { types: policy.allowedContentTypes.join(', '), maxMb })}
      </p>
    </div>
  );
}
