import { PutObjectCommand } from '@aws-sdk/client-s3';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { s3, STORAGE_BUCKET } from '@/lib/storage/client';

import { ruleForContentType } from './policy';

/** Object-storage key prefix for inbound WhatsApp media (kept separate from
 *  exercise media and patient documents; served only via the gated route). */
export const WA_MEDIA_PREFIX = 'whatsapp-media';

function twilioAuthHeader(): string | null {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

export interface StoreMediaResult {
  status: 'STORED' | 'FAILED' | 'SKIPPED';
  reason?: string;
}

/** Which BullMQ attempt this call is (1-based) and how many the job has. The
 *  worker passes its own counters; a direct caller (repair script) passes
 *  `{ attempt: 1, maxAttempts: 1 }` so every outcome is final. */
export interface StoreMediaAttempt {
  attempt: number;
  maxAttempts: number;
}

/**
 * Provider statuses worth another try. Production evidence (08/10, P62
 * session): 8 of ~120 inbound attachments failed with `provider fetch 404`
 * on the FIRST fetch, fired within a second of the webhook — the media
 * resource was not yet readable on Twilio's side although the webhook had
 * already announced it. Treating every 4xx as terminal turned that race
 * into a permanent «تعذّر تنزيل المرفق». 404/408/429 and every 5xx now retry
 * with the job's backoff; 401/403/410/413/415 stay terminal (credentials,
 * forbidden, gone, too large, unsupported — none of them heal by waiting).
 */
export function isRetryableMediaStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

/**
 * P56 — download ONE inbound attachment from the provider's temporary URL
 * (with Basic auth) and store the bytes in object storage. Idempotent: a row
 * already STORED/FAILED/EXPIRED is skipped. Validation (allowlist + size cap)
 * happens here; a disallowed type or oversize file is marked FAILED (never
 * retried). A retryable fetch status throws so BullMQ retries — and on the
 * job's FINAL attempt it is recorded as FAILED instead, so a row never sits
 * in PENDING («جارٍ التنزيل») forever after the retries run out.
 *
 * `fetchImpl` is injectable for tests; defaults to global fetch.
 */
export async function storeInboundMedia(
  args: { attachmentId: string; mediaUrl: string },
  fetchImpl: typeof fetch = fetch,
  attemptInfo: StoreMediaAttempt = { attempt: 1, maxAttempts: 1 },
): Promise<StoreMediaResult> {
  const attachment = await db.whatsAppAttachment.findUnique({
    where: { id: args.attachmentId },
    select: { id: true, status: true, contentType: true, receivedAt: true },
  });
  if (!attachment) return { status: 'SKIPPED', reason: 'not found' };
  if (attachment.status !== 'PENDING') return { status: 'SKIPPED', reason: 'already resolved' };

  const finalAttempt = attemptInfo.attempt >= attemptInfo.maxAttempts;

  const markFailed = async (reason: string): Promise<StoreMediaResult> => {
    await db.whatsAppAttachment.update({
      where: { id: attachment.id },
      data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
    });
    console.warn(`[inbound-media] attachment=${attachment.id} FAILED: ${reason}`);
    return { status: 'FAILED', reason };
  };

  const rule = ruleForContentType(attachment.contentType);
  if (!rule) return markFailed(`disallowed content type: ${attachment.contentType}`);

  const auth = twilioAuthHeader();
  const res = await fetchImpl(args.mediaUrl, auth ? { headers: { Authorization: auth } } : {});
  if (!res.ok) {
    if (isRetryableMediaStatus(res.status) && !finalAttempt) {
      console.warn(
        `[inbound-media] attachment=${attachment.id} provider fetch ${res.status} — retrying (attempt ${attemptInfo.attempt}/${attemptInfo.maxAttempts})`,
      );
      throw new Error(`media fetch failed: ${res.status}`);
    }
    const suffix =
      isRetryableMediaStatus(res.status) && attemptInfo.maxAttempts > 1
        ? ` (after ${attemptInfo.maxAttempts} attempts)`
        : '';
    return markFailed(`provider fetch ${res.status}${suffix}`);
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength === 0) return markFailed('empty media body');
  if (bytes.byteLength > rule.maxBytes) {
    return markFailed(`exceeds ${rule.maxBytes} bytes (${bytes.byteLength})`);
  }

  const d = attachment.receivedAt;
  const datePart =
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0');
  const storageKey = `${WA_MEDIA_PREFIX}/${datePart}/${attachment.id}.${rule.ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: STORAGE_BUCKET,
      Key: storageKey,
      Body: bytes,
      ContentType: attachment.contentType,
      ContentLength: bytes.byteLength,
    }),
  );
  await db.whatsAppAttachment.update({
    where: { id: attachment.id },
    data: { status: 'STORED', storageKey, sizeBytes: bytes.byteLength, failureReason: null },
  });
  console.warn(`[inbound-media] attachment=${attachment.id} STORED key=${storageKey}`);
  return { status: 'STORED' };
}
