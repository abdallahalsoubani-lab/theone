import { S3Client } from '@aws-sdk/client-s3';

import { env } from '@/lib/env';

/**
 * S3-compatible client. Local dev points at MinIO (forcePathStyle is
 * required because MinIO doesn't support virtual-hosted style); the
 * same configuration works against AWS S3 in production — path-style
 * requests are universally supported.
 *
 * Held on globalThis to survive Next.js hot reload — re-building an
 * SDK client on every request is wasteful and floods the connection
 * pool. The presigner from @aws-sdk/s3-request-presigner reads this
 * client.
 */

const globalForS3 = globalThis as unknown as { s3?: S3Client };

function makeClient(): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? 'minio_admin',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? 'minio_admin_change_me',
    },
    forcePathStyle: true,
  });
}

export const s3: S3Client = globalForS3.s3 ?? makeClient();

if (process.env.NODE_ENV !== 'production') {
  globalForS3.s3 = s3;
}

export const STORAGE_BUCKET = env.S3_BUCKET ?? 'theone-uploads';
