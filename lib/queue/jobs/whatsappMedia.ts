import { whatsappMediaQueue, WHATSAPP_MEDIA_QUEUE } from '../queues';

export const FETCH_INBOUND_MEDIA_JOB = 'fetchInboundMedia';

export interface FetchInboundMediaJob {
  attachmentId: string;
  /** The provider's temporary, credentialed media URL — used immediately by
   *  the worker and never persisted (P55: storing the raw URL is not a fix). */
  mediaUrl: string;
}

/** Enqueue a download for one inbound attachment. Deterministic job id so a
 *  redelivered webhook never doubles the fetch. */
export async function enqueueInboundMediaFetch(job: FetchInboundMediaJob): Promise<void> {
  await whatsappMediaQueue.add(FETCH_INBOUND_MEDIA_JOB, job, {
    jobId: `media-${job.attachmentId}`,
  });
}

export { WHATSAPP_MEDIA_QUEUE };
