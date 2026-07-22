import { createUploadUrl } from './actions/createUploadUrl';
import type { UploadKind } from './policies';
import { putWithProgress } from './transport';

/**
 * Browser-side upload orchestrator: asks the server action for an upload
 * ticket (validation + can() + signed capability token), then PUTs the bytes
 * through the shared transport (lib/storage/transport.ts — progress, abort,
 * and the differentiated error taxonomy live there; Prompt 32 §3.1).
 */

export {
  classifyUploadError,
  putWithProgress,
  UploadHttpError,
  type UploadFailureKind,
} from './transport';

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
    fileName: opts.file.name,
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
