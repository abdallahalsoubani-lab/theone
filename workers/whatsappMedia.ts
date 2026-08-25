/**
 * P56 — inbound WhatsApp media worker.
 *
 * Two responsibilities on ONE queue (its own, off the webhook ACK path):
 *   - fetchInboundMedia: download an attachment from the provider's temporary
 *     URL (Basic auth) and store the bytes; retries on transient failure,
 *     marks FAILED on oversize/disallowed/terminal fetch errors.
 *   - whatsappMediaRetention: a daily repeat job deleting binaries older than
 *     the retention window (rows kept as EXPIRED markers).
 */

import { Worker } from 'bullmq';

import { queueRedis } from '@/lib/queue/client';
import { WHATSAPP_MEDIA_QUEUE, whatsappMediaQueue } from '@/lib/queue/queues';
import { FETCH_INBOUND_MEDIA_JOB, type FetchInboundMediaJob } from '@/lib/queue/jobs/whatsappMedia';
import { storeInboundMedia } from '@/lib/whatsapp/media/store';
import { runWhatsappMediaRetention } from '@/lib/whatsapp/media/retention';
import { syncTemplateApproval } from '@/lib/whatsapp/templates/approvalSync';

export const WA_MEDIA_RETENTION_JOB = 'whatsappMediaRetention';
const RETENTION_JOB_ID = 'wa-media-retention';
const RETENTION_CRON = '30 3 * * *'; // 03:30 Asia/Amman daily.
// P52/P53 deploy — sync live WhatsApp template approval daily so the
// v3/combined templates switch on automatically once WhatsApp approves them.
export const WA_TEMPLATE_APPROVAL_JOB = 'whatsappTemplateApprovalSync';
const APPROVAL_JOB_ID = 'wa-template-approval-sync';
const APPROVAL_CRON = '0 * * * *'; // hourly — so the switch is picked up fast.

/** Register the daily retention sweep (idempotent via the deterministic id). */
export async function ensureWhatsappMediaRetentionScheduled(): Promise<void> {
  await whatsappMediaQueue.add(
    WA_MEDIA_RETENTION_JOB,
    {},
    { repeat: { pattern: RETENTION_CRON, tz: 'Asia/Amman' }, jobId: RETENTION_JOB_ID },
  );
}

/** Register the hourly template-approval sync (idempotent via the id). */
export async function ensureTemplateApprovalSyncScheduled(): Promise<void> {
  await whatsappMediaQueue.add(
    WA_TEMPLATE_APPROVAL_JOB,
    {},
    { repeat: { pattern: APPROVAL_CRON, tz: 'Asia/Amman' }, jobId: APPROVAL_JOB_ID },
  );
}

export function startWhatsappMediaWorker(): Worker {
  const worker = new Worker(
    WHATSAPP_MEDIA_QUEUE,
    async (job) => {
      if (job.name === WA_MEDIA_RETENTION_JOB) {
        await runWhatsappMediaRetention();
        return;
      }
      if (job.name === WA_TEMPLATE_APPROVAL_JOB) {
        await syncTemplateApproval();
        return;
      }
      if (job.name === FETCH_INBOUND_MEDIA_JOB) {
        const data = job.data as FetchInboundMediaJob;
        await storeInboundMedia({ attachmentId: data.attachmentId, mediaUrl: data.mediaUrl });
        return;
      }
    },
    { connection: queueRedis },
  );
  worker.on('failed', (job, err) => {
    console.error(`[wa-media] job=${job?.id ?? '<unknown>'} failed: ${err.message}`);
  });
  return worker;
}
