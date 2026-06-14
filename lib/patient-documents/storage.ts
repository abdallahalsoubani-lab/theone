import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { STORAGE_BUCKET, s3 } from '@/lib/storage/client';

const SIGN_TTL_SECONDS = 15 * 60;

/** Presigned PUT URL for a direct browser→S3 upload (no proxy; Prompt 22 §3). */
export async function presignDocumentPut(args: {
  key: string;
  contentType: string;
  sizeBytes: number;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: STORAGE_BUCKET,
    Key: args.key,
    ContentType: args.contentType,
    ContentLength: args.sizeBytes,
  });
  return getSignedUrl(s3, command, {
    expiresIn: SIGN_TTL_SECONDS,
    signableHeaders: new Set(['content-type', 'content-length']),
  });
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
