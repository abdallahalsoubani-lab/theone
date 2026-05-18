import { createUploadUrl, type UploadKind } from './actions/createUploadUrl';

/**
 * Browser-side upload helper. Calls the server action to get a
 * presigned PUT URL, then PUTs the file directly to S3 / MinIO.
 *
 * Progress is reported via the optional `onProgress` callback so the
 * MediaUploader component can render a real loading bar instead of a
 * generic spinner. Abort is supported via AbortController — the
 * upload form should pass one in and call abort() on dismount or
 * cancel.
 */

export interface UploadResult {
  /** Public URL the row should reference. */
  url: string;
  /** Object key — useful for delete operations later. */
  key: string;
  /** MIME type the server validated. */
  mimeType: string;
  /** Final byte count (echoes input.size). */
  sizeBytes: number;
}

export interface UploadOptions {
  kind: UploadKind;
  file: File;
  onProgress?: (fractionComplete: number) => void;
  signal?: AbortSignal;
}

export async function uploadFile(opts: UploadOptions): Promise<UploadResult> {
  const ticket = await createUploadUrl({
    kind: opts.kind,
    contentType: opts.file.type,
    sizeBytes: opts.file.size,
  });
  if (!ticket.ok) throw new Error(ticket.error.message_en);

  await putWithProgress({
    url: ticket.data.uploadUrl,
    file: opts.file,
    contentType: opts.file.type,
    onProgress: opts.onProgress,
    signal: opts.signal,
  });

  return {
    url: ticket.data.publicUrl,
    key: ticket.data.key,
    mimeType: opts.file.type,
    sizeBytes: opts.file.size,
  };
}

function putWithProgress(args: {
  url: string;
  file: File;
  contentType: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    // XMLHttpRequest is the only browser API that exposes upload
    // progress events. fetch's ReadableStream support for upload
    // progress is still Chrome-only as of 2026.
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', args.url);
    xhr.setRequestHeader('Content-Type', args.contentType);
    if (args.onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && e.total > 0) {
          args.onProgress!(e.loaded / e.total);
        }
      });
    }
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload network error')));
    xhr.addEventListener('abort', () => reject(new DOMException('Upload aborted', 'AbortError')));
    if (args.signal) {
      if (args.signal.aborted) {
        xhr.abort();
        return;
      }
      args.signal.addEventListener('abort', () => xhr.abort());
    }
    xhr.send(args.file);
  });
}
