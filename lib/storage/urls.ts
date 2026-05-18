import { env } from '@/lib/env';

import { STORAGE_BUCKET } from './client';

/**
 * Public URL for an object — used in `<img src>` / `<video src>` once
 * the upload finishes. Local dev hits MinIO directly; production swaps
 * S3_PUBLIC_BASE_URL to the CDN (CloudFront / Cloudflare). When the
 * env var is unset we fall back to the endpoint + bucket so the URL
 * still resolves in dev.
 *
 * Lives in its own module because `createUploadUrl.ts` carries
 * 'use server' — that pragma forbids non-async exports.
 */
export function buildPublicUrl(key: string): string {
  const base =
    process.env.S3_PUBLIC_BASE_URL ??
    `${(env.S3_ENDPOINT ?? 'http://localhost:9000').replace(/\/$/, '')}/${STORAGE_BUCKET}`;
  return `${base}/${key}`;
}

// Re-export the policy helpers for client components that need the size /
// type metadata to render hint copy.
export { getUploadPolicy } from './policies';
export type { UploadKind } from './policies';
