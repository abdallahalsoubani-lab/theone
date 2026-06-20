/**
 * Storage URLs (Fix Prompt 4 — proxy-upload path).
 *
 * Both reads and uploads go through the same-origin Next route
 * `/api/v1/storage/<key>` rather than directly to MinIO: on the single-VM
 * topology MinIO is localhost-only, so a direct `http://localhost:9000/...`
 * URL is unreachable from the browser (and mixed-content-blocked on HTTPS).
 * The relative path resolves through nginx → Next → MinIO.
 *
 * Lives in its own module because `createUploadUrl.ts` carries 'use server' —
 * that pragma forbids non-async exports.
 */
const STORAGE_ROUTE = '/api/v1/storage';

/** GET URL stored on the row and used in `<img src>` / `<video src>`. */
export function buildPublicUrl(key: string): string {
  return `${STORAGE_ROUTE}/${key}`;
}

/** PUT URL the browser uploads to, carrying the short-lived capability token. */
export function proxyUploadUrl(key: string, token: string): string {
  return `${STORAGE_ROUTE}/${key}?t=${encodeURIComponent(token)}`;
}

// Re-export the policy helpers for client components that need the size /
// type metadata to render hint copy.
export { getUploadPolicy } from './policies';
export type { UploadKind } from './policies';
