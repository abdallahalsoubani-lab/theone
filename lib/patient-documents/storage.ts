import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

import { STORAGE_BUCKET, s3 } from '@/lib/storage/client';
import { signUploadToken, UPLOAD_TTL_SECONDS } from '@/lib/storage/uploadToken';
import { proxyUploadUrl } from '@/lib/storage/urls';

const SIGN_TTL_SECONDS = UPLOAD_TTL_SECONDS;

/**
 * Upload URL for a patient document (Prompt 22 §3; reworked to the proxy-upload
 * path in Fix Prompt 4 — MinIO isn't browser-reachable on the VM). Returns a
 * same-origin PUT URL carrying a signed capability token scoped to this key +
 * content-type + size; the proxy route streams the bytes to MinIO. The PENDING
 * row + finalize sniff (server-side) are unchanged.
 */
export async function presignDocumentPut(args: {
  key: string;
  contentType: string;
  sizeBytes: number;
}): Promise<string> {
  const token = await signUploadToken({
    key: args.key,
    contentType: args.contentType,
    maxBytes: args.sizeBytes,
  });
  return proxyUploadUrl(args.key, token);
}

/** Read the first `n` bytes of the stored object for the magic-byte sniff. */
export async function getObjectHeadBytes(key: string, n = 32): Promise<Uint8Array> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: key, Range: `bytes=0-${n - 1}` }),
  );
  if (!res.Body) return new Uint8Array(0);
  return res.Body.transformToByteArray();
}

/** Full object bytes — used by the can()-gated download route. */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await s3.send(new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
  if (!res.Body) return new Uint8Array(0);
  return res.Body.transformToByteArray();
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
}

export { SIGN_TTL_SECONDS };
