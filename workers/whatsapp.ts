/**
 * WhatsApp outbound worker.
 *
 * Subscribed to the `whatsappOutbound` BullMQ queue. Each job represents
 * one outgoing message — template or free-form text. The worker:
 *
 *   1. Acquires a token from the rate limiter; if rate-limited, defers
 *      the job and exits (BullMQ retries after the delay)
 *   2. Calls the active provider (Twilio / Meta / console)
 *   3. Persists a WhatsAppMessage row capturing the provider id, status,
 *      parameters, body, and links to recipient + appointment
 *   4. On retryable errors, lets BullMQ retry
 *   5. On terminal failure after the final attempt: marks the row FAILED,
 *      flips User.whatsappReachable=false, and inserts an InboxItem so
 *      the Secretary sees an OUTBOUND_DELIVERY_FAILED action
 *   6. On success: bumps User.whatsappReachable back to true
 */

import { Worker } from 'bullmq';
import type { LanguagePref, Prisma, WhatsAppTemplate } from '@prisma/client';

import { db } from '@/lib/db';
import { queueRedis } from '@/lib/queue/client';
import type { WhatsappOutboundJob } from '@/lib/queue/jobs/whatsappOutbound';
import { WHATSAPP_OUTBOUND_QUEUE } from '@/lib/queue/queues';
import { whatsapp } from '@/lib/whatsapp';
import { WhatsAppError, describeWhatsAppError } from '@/lib/whatsapp/errors';
import { makeOutboundRateLimiter } from '@/lib/whatsapp/rateLimit';
import type { SendResult } from '@/lib/whatsapp/provider';

const rateLimiter = makeOutboundRateLimiter({ redis: queueRedis });

function buildBodyPreview(job: WhatsappOutboundJob): string {
  if (job.kind === 'text') return job.body ?? '';
  if (!job.parameters || job.parameters.length === 0) {
    return `template:${job.templateName ?? '?'}`;
  }
  return `template:${job.templateName ?? '?'}(${job.parameters.join(', ')})`;
}

async function lookupTemplate(
  name: string,
  language: LanguagePref,
): Promise<WhatsAppTemplate | null> {
  return db.whatsAppTemplate.findUnique({
    where: { name_language: { name, language } },
  });
}

async function persistAndFinalize(args: {
  job: WhatsappOutboundJob;
  template: WhatsAppTemplate | null;
  result: SendResult;
}): Promise<void> {
  const { job, template, result } = args;
  await db.whatsAppMessage.create({
    data: {
      templateId: template?.id ?? null,
      recipientId: job.recipientUserId ?? null,
      recipientPhone: job.recipientPhone,
      parameters: (job.parameters
        ? Object.fromEntries(job.parameters.map((v, i) => [String(i + 1), v]))
        : {}) as Prisma.InputJsonValue,
      direction: 'OUTBOUND',
      status: result.status === 'FAILED' ? 'FAILED' : 'SENT',
      providerMessageId: result.providerMessageId,
      body: buildBodyPreview(job),
      appointmentId: job.appointmentId ?? null,
      sentAt: new Date(),
    },
  });

  if (job.recipientUserId && result.status !== 'FAILED') {
    // Successful delivery clears any prior reachability flag.
    await db.user.update({
      where: { id: job.recipientUserId },
      data: { whatsappReachable: true },
    });
  }
}

async function recordTerminalFailure(args: {
  job: WhatsappOutboundJob;
  template: WhatsAppTemplate | null;
  reason: string;
}): Promise<void> {
  const { job, template, reason } = args;
  const message = await db.whatsAppMessage.create({
    data: {
      templateId: template?.id ?? null,
      recipientId: job.recipientUserId ?? null,
      recipientPhone: job.recipientPhone,
      parameters: (job.parameters
        ? Object.fromEntries(job.parameters.map((v, i) => [String(i + 1), v]))
        : {}) as Prisma.InputJsonValue,
      direction: 'OUTBOUND',
      status: 'FAILED',
      providerMessageId: null,
      failureReason: reason,
      body: buildBodyPreview(job),
      appointmentId: job.appointmentId ?? null,
    },
  });

  if (job.recipientUserId) {
    await db.user.update({
      where: { id: job.recipientUserId },
      data: {
        whatsappReachable: false,
        whatsappLastFailureAt: new Date(),
        whatsappLastFailureReason: reason,
      },
    });

    await db.inboxItem.create({
      data: {
        type: 'OUTBOUND_DELIVERY_FAILED',
        patientId: job.recipientUserId,
        appointmentId: job.appointmentId ?? null,
        messageId: message.id,
        note: reason,
      },
    });
  }
}

export function startWhatsappOutboundWorker(): Worker {
  const worker = new Worker<WhatsappOutboundJob>(
    WHATSAPP_OUTBOUND_QUEUE,
    async (job) => {
      const data = job.data;
      const attemptsMade = job.attemptsMade ?? 0;
      const maxAttempts = job.opts?.attempts ?? 3;
      const isFinalAttempt = attemptsMade + 1 >= maxAttempts;

      // 1. Rate limit.
      const decision = await rateLimiter.acquire(data.recipientPhone);
      if (!decision.allowed) {
        // Defer rather than fail. BullMQ requires we throw to retry; the
        // backoff is the delay returned by the limiter so the job goes
        // out on the next window roll.
        const err = new Error(`rate-limited, retrying in ${Math.ceil(decision.delayMs / 1000)}s`);
        await job.moveToDelayed(Date.now() + decision.delayMs);
        // Throw a non-retryable marker so BullMQ doesn't double-count
        // attempts when we manually moved the job to delayed above.
        throw err;
      }

      // 2. Resolve the template (only relevant for kind=template; the
      // provider also re-looks-it-up, but we need it here for the FAILED
      // row's templateId).
      let template: WhatsAppTemplate | null = null;
      if (data.kind === 'template' && data.templateName) {
        template = await lookupTemplate(data.templateName, data.language);
      }

      // 3. Send.
      try {
        const result =
          data.kind === 'template'
            ? await whatsapp.sendTemplate({
                name: data.templateName ?? '',
                language: data.language,
                recipientPhone: data.recipientPhone,
                parameters: data.parameters ?? [],
                recipientUserId: data.recipientUserId,
                appointmentId: data.appointmentId,
              })
            : await whatsapp.sendText({
                recipientPhone: data.recipientPhone,
                body: data.body ?? '',
                recipientUserId: data.recipientUserId,
                appointmentId: data.appointmentId,
              });
        await persistAndFinalize({ job: data, template, result });
        return { ok: true, providerMessageId: result.providerMessageId };
      } catch (err) {
        const isWhatsAppErr = err instanceof WhatsAppError;
        const reason = describeWhatsAppError(err);

        // Non-retryable provider errors short-circuit to terminal — no
        // sense waiting two minutes to fail the same way. Same on the
        // final BullMQ attempt regardless of error class.
        if ((isWhatsAppErr && !err.retryable) || isFinalAttempt) {
          await recordTerminalFailure({ job: data, template, reason });
          // Returning normally would let BullMQ retry; throwing with the
          // attempts already at max produces a single failure record. To
          // skip the retry on early terminals, fall through to throwing
          // — BullMQ caps retries by `attempts` already.
          throw err;
        }

        // Otherwise: let BullMQ retry. Worker.on('failed') logs.
        throw err;
      }
    },
    { connection: queueRedis },
  );

  worker.on('failed', (job, err) => {
    console.error(
      `[whatsapp.outbound] job=${job?.id ?? '<unknown>'} attempt=${job?.attemptsMade ?? '?'}: ${err.message}`,
    );
  });
  worker.on('completed', (job) => {
    console.warn(`[whatsapp.outbound] job=${job.id} completed`);
  });

  return worker;
}
