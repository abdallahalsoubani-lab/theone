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
  maxSizeBytes: 5 * 1024 * 1024, // 5 MB — modern browsers handle this fine without thumbnails.
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
  // 50 MB. Bigger files invite transcoding pipelines that are out of v1
  // scope; the Exercise form's hint copy tells therapists to keep clips
  // under a minute at 720p.
  maxSizeBytes: 50 * 1024 * 1024,
  // MP4 / H.264 plays in every modern browser without transcoding. We
  // reject MOV / WebM / etc. with a clear localized error rather than
  // silently accept-and-break-playback.
  allowedContentTypes: ['video/mp4'],
  extensionFor(ct) {
    return ct === 'video/mp4' ? 'mp4' : null;
  },
  keyPrefix: 'exercises/video',
};

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
