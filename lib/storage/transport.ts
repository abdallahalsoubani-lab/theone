/**
 * Browser→storage-proxy transport (Prompt 32 §3.1) — the ONE place every
 * upload surface sends bytes and classifies failures. Pure of server imports
 * (no auth/db/action chain) so client components and unit tests load it
 * without dragging the Next.js server graph in. `lib/storage/upload.ts`
 * composes this with the ticket-issuing server action.
 */

/**
 * Thrown when the storage proxy answers with a non-2xx status. Carries the
 * HTTP status so the UI can map specific failures instead of leaking raw text.
 */
export class UploadHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Upload failed: HTTP ${status}`);
    this.name = 'UploadHttpError';
  }
}

/**
 * Differentiated failure classes every upload surface translates (Prompt 32
 * §3.3 — QA only ever saw one generic «فشل الرفع» string, which made the real
 * cause undiagnosable). Each maps to its own i18n key at the call site:
 *   too_large            → 413 (nginx or the storage route's size ceiling)
 *   storage_unavailable  → 502/503/504 (object store down/misconfigured)
 *   unauthorized         → 401/403 (expired capability token / session)
 *   network              → the request never completed (offline, reset)
 *   unknown              → anything else (last resort)
 */
export type UploadFailureKind =
  | 'too_large'
  | 'storage_unavailable'
  | 'unauthorized'
  | 'network'
  | 'unknown';

export function classifyUploadError(err: unknown): UploadFailureKind {
  if (err instanceof UploadHttpError) {
    if (err.status === 413) return 'too_large';
    if (err.status === 502 || err.status === 503 || err.status === 504)
      return 'storage_unavailable';
    if (err.status === 401 || err.status === 403) return 'unauthorized';
    return 'unknown';
  }
  if (err instanceof Error && err.message === 'Upload network error') return 'network';
  return 'unknown';
}

/**
 * Raw PUT to a storage upload URL with progress + abort. Shared by every
 * upload surface (exercise media via uploadFile, patient documents via their
 * ticket flow) — one transport, one error taxonomy.
 */
export function putWithProgress(args: {
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
      else reject(new UploadHttpError(xhr.status));
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
