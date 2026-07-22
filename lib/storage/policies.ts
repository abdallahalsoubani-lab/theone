/**
 * Upload constraints — per-kind allowlists + size limits.
 *
 * The presigned URL signs Content-Type + Content-Length headers; S3 / MinIO
 * reject mismatching uploads with a 403 at PUT time. The constraints here
 * are also enforced in the server action before the URL is signed so an
 * obvious-misuse case (someone trying to upload a 1 GB MOV) doesn't burn
 * a presign just to fail at the bucket.
 */

export type UploadKind = 'exercise_image' | 'exercise_video';

export interface UploadPolicy {
  /** Bytes — hard ceiling. */
  maxSizeBytes: number;
  /** MIME types accepted. */
  allowedContentTypes: ReadonlyArray<string>;
  /** Extensions corresponding to the MIME types — used when building the key. */
  extensionFor(contentType: string): string | null;
  /** Subfolder under the bucket root — keeps exercise/* distinct. */
  keyPrefix: string;
}

const IMAGE_POLICY: UploadPolicy = {
  // 10 MB (Prompt 32) — a modern phone photo is routinely 4–8 MB; the old
  // 5 MB ceiling pre-flight-rejected exactly the pictures doctors take.
  maxSizeBytes: 10 * 1024 * 1024,
  allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  extensionFor(ct) {
    switch (ct) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      default:
        return null;
    }
  },
  keyPrefix: 'exercises/img',
};

const VIDEO_POLICY: UploadPolicy = {
  // 100 MB (Prompt 32) — covers ~1 min of unedited 1080p phone footage; the
  // clinic has no transcoding tooling, so raw camera output must fit. The
  // nginx `client_max_body_size` on /api/v1/storage/ must stay above this
  // (batch-deploy checklist bumps it to 105m).
  maxSizeBytes: 100 * 1024 * 1024,
  // What phone cameras actually emit: MP4/H.264 (Android, universal), MOV
  // (iPhone — plays in every modern browser when H.264), WebM (screen
  // recorders). Rejecting MOV was the "videos never upload" half of D-8:
  // every iPhone clip died at the pre-flight type check.
  allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
  extensionFor(ct) {
    switch (ct) {
      case 'video/mp4':
        return 'mp4';
      case 'video/quicktime':
        return 'mov';
      case 'video/webm':
        return 'webm';
      default:
        return null;
    }
  },
  keyPrefix: 'exercises/video',
};

/** File extensions considered consistent with each allowed MIME type —
 *  uploads whose original filename contradicts the declared type are refused
 *  server-side (Prompt 32 §3.4). Files with no extension pass (the key is
 *  server-built from the MIME type either way). */
const EXTENSIONS_FOR_TYPE: Record<string, ReadonlyArray<string>> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'video/mp4': ['mp4', 'm4v'],
  'video/quicktime': ['mov'],
  'video/webm': ['webm'],
};

export function extensionMatchesType(fileName: string, contentType: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return true; // extension-less names pass
  const ext = fileName.slice(dot + 1).toLowerCase();
  const allowed = EXTENSIONS_FOR_TYPE[contentType];
  return allowed ? allowed.includes(ext) : false;
}

const POLICIES: Record<UploadKind, UploadPolicy> = {
  exercise_image: IMAGE_POLICY,
  exercise_video: VIDEO_POLICY,
};

export function getUploadPolicy(kind: UploadKind): UploadPolicy {
  return POLICIES[kind];
}

export interface UploadValidationError {
  code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'UNKNOWN_KIND';
  message: string;
}

export function validateUploadInput(args: {
  kind: UploadKind;
  contentType: string;
  sizeBytes: number;
  /** Original filename — when present, its extension must not contradict the
   *  declared content-type (server-side check, Prompt 32 §3.4). */
  fileName?: string;
}): UploadValidationError | null {
  const policy = POLICIES[args.kind];
  if (!policy) {
    return { code: 'UNKNOWN_KIND', message: `Unknown upload kind: ${args.kind}` };
  }
  if (!policy.allowedContentTypes.includes(args.contentType)) {
    return {
      code: 'UNSUPPORTED_TYPE',
      message: `Content type ${args.contentType} is not allowed for ${args.kind}.`,
    };
  }
  if (args.fileName && !extensionMatchesType(args.fileName, args.contentType)) {
    return {
      code: 'UNSUPPORTED_TYPE',
      message: `File extension of "${args.fileName}" does not match ${args.contentType}.`,
    };
  }
  if (args.sizeBytes <= 0 || args.sizeBytes > policy.maxSizeBytes) {
    return {
      code: 'TOO_LARGE',
      message: `Size ${args.sizeBytes} bytes exceeds the ${policy.maxSizeBytes}-byte limit for ${args.kind}.`,
    };
  }
  return null;
}

/**
 * Build the object key. Format: `{prefix}/{userId}/{YYYYMMDD}/{uuid}.{ext}`
 * — easy to scope per-user with bucket policies later, and the date
 * segment makes manual cleanup of test uploads straightforward.
 */
export function buildObjectKey(args: {
  kind: UploadKind;
  userId: string;
  contentType: string;
  now?: Date;
}): string {
  const policy = POLICIES[args.kind];
  const ext = policy.extensionFor(args.contentType) ?? 'bin';
  const now = args.now ?? new Date();
  const date =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0');
  // Random 12-char base36 suffix — collision probability vanishingly low
  // for clinic-scale upload volume; no need to invoke node:crypto for a
  // proper UUID here.
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return `${policy.keyPrefix}/${args.userId}/${date}/${id}.${ext}`;
}
