'use server';

import { auth } from '@/auth';
import type { Result } from '@/lib/auth/result';
import type { LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';
import {
  buildObjectKey,
  getUploadPolicy,
  validateUploadInput,
  type UploadKind,
} from '@/lib/storage/policies';
import { signUploadToken, UPLOAD_TTL_SECONDS } from '@/lib/storage/uploadToken';
import { buildPublicUrl, proxyUploadUrl } from '@/lib/storage/urls';

/**
 * Issue an upload capability for a single object (Prompt 10 §4.2.2; reworked to
 * the proxy-upload path in Fix Prompt 4). Validates kind/type/size, runs the
 * can() check, builds the object key, and returns a same-origin PUT URL carrying
 * a short-lived signed token. The browser PUTs the file to that URL via
 * <MediaUploader>; the proxy route streams it to MinIO. Token TTL is 15 min.
 */

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

  // Proxy-upload path (Fix Prompt 4): instead of an S3 presigned URL (MinIO is
  // not browser-reachable on the VM), issue a signed capability token scoped to
  // this key + content-type + size, and point the browser at the same-origin
  // proxy route. The can() check above already gated this.
  const token = await signUploadToken({
    key,
    contentType: input.contentType,
    maxBytes: getUploadPolicy(input.kind).maxSizeBytes,
  });

  return {
    ok: true,
    data: {
      uploadUrl: proxyUploadUrl(key, token),
      key,
      publicUrl: buildPublicUrl(key),
      expiresInSeconds: UPLOAD_TTL_SECONDS,
    },
  };
}
