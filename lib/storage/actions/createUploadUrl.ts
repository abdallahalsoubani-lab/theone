'use server';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { auth } from '@/auth';
import type { Result } from '@/lib/auth/result';
import type { LocalizedError } from '@/lib/db';
import { env } from '@/lib/env';
import { requirePermission } from '@/lib/rbac/guards';
import { STORAGE_BUCKET, s3 } from '@/lib/storage/client';
import { buildObjectKey, validateUploadInput, type UploadKind } from '@/lib/storage/policies';

/**
 * Generate a presigned PUT URL for a direct browser-to-S3 upload
 * (Prompt 10 §4.2.2). The presign signs the URL plus the
 * Content-Type and Content-Length headers so MinIO/S3 rejects any
 * mismatch with a 403 at PUT time. The browser then PUTs the file
 * with those exact headers via <MediaUploader>.
 *
 * URL expires in 15 minutes — long enough for a slow connection on
 * a 50 MB video, short enough that a leaked URL stops being useful
 * fast.
 */

const SIGN_TTL_SECONDS = 15 * 60;

interface CreateUploadUrlInput {
  kind: UploadKind;
  contentType: string;
  sizeBytes: number;
}

export interface UploadTicket {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  expiresInSeconds: number;
}

export async function createUploadUrl(
  input: CreateUploadUrlInput,
): Promise<Result<UploadTicket, LocalizedError>> {
  // Exercise create/update are the only callers in v1; the broader
  // exercises.create permission covers both surfaces. Edits create new
  // rows (per Prompt 10 §4.3.4) so the same write permission applies.
  await requirePermission('exercises.create');

  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        message_en: 'Sign-in required.',
        message_ar: 'يلزم تسجيل الدخول.',
      },
    };
  }

  const error = validateUploadInput(input);
  if (error) {
    return {
      ok: false,
      error: {
        code: error.code,
        message_en: error.message,
        message_ar:
          error.code === 'TOO_LARGE'
            ? 'حجم الملف يتجاوز الحد المسموح.'
            : error.code === 'UNSUPPORTED_TYPE'
              ? 'نوع الملف غير مدعوم.'
              : 'نوع الرفع غير معروف.',
      },
    };
  }

  const key = buildObjectKey({
    kind: input.kind,
    userId: session.user.id,
    contentType: input.contentType,
  });

  const command = new PutObjectCommand({
    Bucket: STORAGE_BUCKET,
    Key: key,
    ContentType: input.contentType,
    ContentLength: input.sizeBytes,
  });

  // signableHeaders ensures the browser must send the same Content-Type
  // (and ContentLength via the SDK) for the signature to match.
  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: SIGN_TTL_SECONDS,
    signableHeaders: new Set(['content-type', 'content-length']),
  });

  return {
    ok: true,
    data: {
      uploadUrl,
      key,
      publicUrl: buildPublicUrl(key),
      expiresInSeconds: SIGN_TTL_SECONDS,
    },
  };
}

// Module-local — 'use server' files can only export async functions, so
// buildPublicUrl and the policy re-exports live in '@/lib/storage/urls'.
function buildPublicUrl(key: string): string {
  const base =
    process.env.S3_PUBLIC_BASE_URL ??
    `${(env.S3_ENDPOINT ?? 'http://localhost:9000').replace(/\/$/, '')}/${STORAGE_BUCKET}`;
  return `${base}/${key}`;
}
