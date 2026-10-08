import { whatsappMediaQueue, WHATSAPP_MEDIA_QUEUE } from '../queues';

export const FETCH_INBOUND_MEDIA_JOB = 'fetchInboundMedia';

export interface FetchInboundMediaJob {
  attachmentId: string;
  /** The provider's temporary, credentialed media URL — used immediately by
   *  the worker and never persisted (P55: storing the raw URL is not a fix). */
  mediaUrl: string;
}

/**
 * Retry budget for ONE inbound download. Twilio can answer 404 for a media
 * resource in the first second(s) after its own webhook announced it
 * (production: 8 of ~120 attachments, 08/10) — the fetch has to come back a
 * little later. Exponential from 15s: 15s · 30s · 1m · 2m · 4m ≈ 8 minutes of
 * patience, far inside the media URL's validity, before the worker records a
 * terminal FAILED (lib/whatsapp/media/store.ts).
 */
export const FETCH_INBOUND_MEDIA_ATTEMPTS = 6;
export const FETCH_INBOUND_MEDIA_BACKOFF_MS = 15_000;

/** Enqueue a download for one inbound attachment. Deterministic job id so a
 *  redelivered webhook never doubles the fetch. */
export async function enqueueInboundMediaFetch(job: FetchInboundMediaJob): Promise<void> {
  await whatsappMediaQueue.add(FETCH_INBOUND_MEDIA_JOB, job, {
    jobId: `media-${job.attachmentId}`,
    attempts: FETCH_INBOUND_MEDIA_ATTEMPTS,
    backoff: { type: 'exponential', delay: FETCH_INBOUND_MEDIA_BACKOFF_MS },
  });
}

export { WHATSAPP_MEDIA_QUEUE };
