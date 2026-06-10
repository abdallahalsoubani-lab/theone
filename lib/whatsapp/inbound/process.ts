import { AppointmentStatus, AuditAction } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { queueRedis } from '@/lib/queue/client';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { parseIntent } from './parser';
import type { WebhookEvent } from '../provider';

/**
 * Shared inbound webhook event processor. Wired from
 * `/api/v1/whatsapp/webhook/meta`.
 *
 * Three event shapes flow through here, provider-normalized:
 *
 *   1. Delivery status updates (sent / delivered / read / failed).
 *      Match the outbound WhatsAppMessage by providerMessageId and
 *      update its status + timestamps.
 *
 *   2. Inbound messages from patients. Insert a WhatsAppMessage row
 *      with direction=INBOUND, classify intent, link to the recent
 *      outbound appointment-related message (24h window), and dispatch
 *      to the per-intent handler.
 *
 *   3. (Future) media / interactive / location — currently unhandled
 *      but a row is still recorded with body='' and intent=UNKNOWN so
 *      nothing disappears silently.
 *
 * Idempotency: providers retry webhooks. Each event carries a provider
 * message id. We use a Redis SET with a 7-day TTL to deduplicate inbound
 * (so duplicate replies don't double-confirm appointments) and the
 * existence of the outbound row's providerMessageId to deduplicate
 * status updates.
 */

const PROCESSED_KEY = (id: string) => `wa:webhook:processed:${id}`;
const PROCESSED_TTL_SECONDS = 60 * 60 * 24 * 7;

async function markProcessed(id: string): Promise<boolean> {
  // Returns true if this event has not been seen before. NX = only set if
  // missing; EX = TTL so the key auto-expires.
  const ok = await queueRedis.set(PROCESSED_KEY(id), '1', 'EX', PROCESSED_TTL_SECONDS, 'NX');
  return ok === 'OK';
}

const RECENT_OUTBOUND_WINDOW_MS = 24 * 60 * 60 * 1000;

async function findRelatedAppointment(args: {
  fromPhone: string;
}): Promise<{ appointmentId: string | null; recipientId: string | null }> {
  // Identify the patient by phone. If the number isn't registered we'll
  // still record the inbound (recipientId=null); the Secretary inbox
  // surfaces unrecognized senders.
  const user = await db.user.findFirst({
    where: { phone: args.fromPhone, deletedAt: null },
    select: { id: true },
  });
  const recipientId = user?.id ?? null;

  // Walk back at most 24h looking for the most recent outbound message
  // to this phone that had an appointment link. That's the appointment
  // this reply concerns.
  const recentOutbound = await db.whatsAppMessage.findFirst({
    where: {
      recipientPhone: args.fromPhone,
      direction: 'OUTBOUND',
      appointmentId: { not: null },
      sentAt: { gte: new Date(Date.now() - RECENT_OUTBOUND_WINDOW_MS) },
    },
    orderBy: { sentAt: 'desc' },
    select: { appointmentId: true },
  });
  return { appointmentId: recentOutbound?.appointmentId ?? null, recipientId };
}

async function handleStatusUpdate(args: {
  providerMessageId: string;
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  occurredAt: Date;
  failureReason?: string;
}): Promise<void> {
  const existing = await db.whatsAppMessage.findFirst({
    where: { providerMessageId: args.providerMessageId },
    select: { id: true, status: true, recipientId: true },
  });
  if (!existing) {
    // The status callback may arrive before we've persisted the outbound
    // row (race between provider response + worker write). Skip silently;
    // the worker will land the row imminently and BullMQ will not redeliver
    // this webhook on its own.
    return;
  }
  // Don't move backwards (READ → DELIVERED), don't overwrite FAILED.
  if (existing.status === 'FAILED' && args.status !== 'FAILED') return;
  if (existing.status === 'READ' && args.status === 'DELIVERED') return;

  await db.whatsAppMessage.update({
    where: { id: existing.id },
    data: {
      status: args.status,
      deliveredAt:
        args.status === 'DELIVERED' || args.status === 'READ' ? args.occurredAt : undefined,
      readAt: args.status === 'READ' ? args.occurredAt : undefined,
      failureReason: args.status === 'FAILED' ? (args.failureReason ?? null) : undefined,
    },
  });

  if (args.status === 'FAILED' && existing.recipientId) {
    await db.user.update({
      where: { id: existing.recipientId },
      data: {
        whatsappReachable: false,
        whatsappLastFailureAt: args.occurredAt,
        whatsappLastFailureReason: args.failureReason ?? 'failed',
      },
    });
  }
}

async function handleInbound(args: {
  providerMessageId: string;
  fromPhone: string;
  body: string;
  receivedAt: Date;
}): Promise<void> {
  const intent = parseIntent(args.body);
  const link = await findRelatedAppointment({ fromPhone: args.fromPhone });

  const inserted = await db.whatsAppMessage.create({
    data: {
      direction: 'INBOUND',
      status: 'DELIVERED',
      recipientPhone: args.fromPhone,
      recipientId: link.recipientId,
      providerMessageId: args.providerMessageId,
      body: args.body,
      parameters: {} as Prisma.InputJsonValue,
      intent,
      appointmentId: link.appointmentId,
      sentAt: args.receivedAt,
    },
    select: { id: true },
  });

  switch (intent) {
    case 'CONFIRM':
      await handleConfirm({
        appointmentId: link.appointmentId,
        recipientId: link.recipientId,
        recipientPhone: args.fromPhone,
        messageId: inserted.id,
      });
      break;
    case 'RESCHEDULE_REQUEST':
      await handleRescheduleRequest({
        appointmentId: link.appointmentId,
        recipientId: link.recipientId,
        recipientPhone: args.fromPhone,
        messageId: inserted.id,
        body: args.body,
      });
      break;
    case 'CANCEL_REQUEST':
      await handleCancelRequest({
        appointmentId: link.appointmentId,
        recipientId: link.recipientId,
        recipientPhone: args.fromPhone,
        messageId: inserted.id,
        body: args.body,
      });
      break;
    case 'UNKNOWN':
    default:
      await handleUnknown({
        recipientId: link.recipientId,
        appointmentId: link.appointmentId,
        messageId: inserted.id,
        body: args.body,
      });
  }
}

async function handleConfirm(args: {
  appointmentId: string | null;
  recipientId: string | null;
  recipientPhone: string;
  messageId: string;
}): Promise<void> {
  if (!args.appointmentId || !args.recipientId) {
    // No appointment to confirm against — drop in the inbox as UNKNOWN
    // so the Secretary triages.
    await db.inboxItem.create({
      data: {
        type: 'INBOUND_UNKNOWN',
        patientId: args.recipientId,
        messageId: args.messageId,
        note: 'CONFIRM with no matched appointment',
      },
    });
    return;
  }
  const appt = await db.appointment.findUnique({
    where: { id: args.appointmentId },
    select: { id: true, status: true, patientId: true, startsAt: true },
  });
  if (!appt) return;
  // Only act on still-actionable bookings.
  if (appt.status === AppointmentStatus.SCHEDULED) {
    await db.appointment.update({
      where: { id: appt.id },
      data: { status: AppointmentStatus.CONFIRMED },
    });
    // Audit with the patient as actor — they authenticated implicitly by
    // sending the WhatsApp reply through the signed-and-verified webhook.
    await db.auditLog.create({
      data: {
        actorId: appt.patientId,
        entityType: 'Appointment',
        entityId: appt.id,
        action: AuditAction.UPDATE,
        after: {
          event: 'CONFIRMED_VIA_WHATSAPP',
          messageId: args.messageId,
        } as Prisma.InputJsonValue,
      },
    });
  }
  // Send acknowledgement (free-form text inside the 24h window).
  await enqueueWhatsappOutbound({
    kind: 'text',
    body: 'Thank you, your appointment is confirmed. شكراً، تم تأكيد موعدك.',
    language: 'EN',
    recipientPhone: args.recipientPhone,
    recipientUserId: args.recipientId,
    appointmentId: appt.id,
    source: 'inbound_ack',
  });
}

async function handleRescheduleRequest(args: {
  appointmentId: string | null;
  recipientId: string | null;
  recipientPhone: string;
  messageId: string;
  body: string;
}): Promise<void> {
  await db.inboxItem.create({
    data: {
      type: 'INBOUND_RESCHEDULE_REQUEST',
      patientId: args.recipientId,
      appointmentId: args.appointmentId,
      messageId: args.messageId,
      note: args.body.slice(0, 280),
    },
  });
  await enqueueWhatsappOutbound({
    kind: 'text',
    body:
      'We received your reschedule request and will contact you to confirm. ' +
      'تم استلام طلبك لإعادة الجدولة وسنتواصل معك للتأكيد.',
    language: 'EN',
    recipientPhone: args.recipientPhone,
    recipientUserId: args.recipientId,
    appointmentId: args.appointmentId,
    source: 'inbound_ack',
  });
}

async function handleCancelRequest(args: {
  appointmentId: string | null;
  recipientId: string | null;
  recipientPhone: string;
  messageId: string;
  body: string;
}): Promise<void> {
  // v1: surface in the inbox for the Secretary to action — we don't
  // auto-cancel because the cancellation category and short-notice flag
  // need human judgement.
  await db.inboxItem.create({
    data: {
      type: 'INBOUND_CANCEL_REQUEST',
      patientId: args.recipientId,
      appointmentId: args.appointmentId,
      messageId: args.messageId,
      note: args.body.slice(0, 280),
    },
  });
  await enqueueWhatsappOutbound({
    kind: 'text',
    body:
      'We received your cancellation request and will contact you to confirm. ' +
      'تم استلام طلب الإلغاء وسنتواصل معك للتأكيد.',
    language: 'EN',
    recipientPhone: args.recipientPhone,
    recipientUserId: args.recipientId,
    appointmentId: args.appointmentId,
    source: 'inbound_ack',
  });
}

async function handleUnknown(args: {
  recipientId: string | null;
  appointmentId: string | null;
  messageId: string;
  body: string;
}): Promise<void> {
  await db.inboxItem.create({
    data: {
      type: 'INBOUND_UNKNOWN',
      patientId: args.recipientId,
      appointmentId: args.appointmentId,
      messageId: args.messageId,
      note: args.body.slice(0, 280),
    },
  });
  // No auto-acknowledgement on UNKNOWN — the Secretary picks the right
  // human reply rather than us sending a generic "we got your message"
  // that might feel dismissive.
}

export async function processWebhookEvent(event: WebhookEvent): Promise<void> {
  if (event.kind === 'status') {
    if (!(await markProcessed(`status:${event.status.providerMessageId}:${event.status.status}`))) {
      return; // duplicate
    }
    await handleStatusUpdate(event.status);
    return;
  }
  // inbound
  if (!(await markProcessed(`inbound:${event.message.providerMessageId}`))) {
    return; // duplicate
  }
  await handleInbound(event.message);
}

export async function processWebhookEvents(events: WebhookEvent[]): Promise<void> {
  for (const event of events) {
    try {
      await processWebhookEvent(event);
    } catch (err) {
      // Never throw out of the webhook handler — we want to acknowledge
      // 200 to the provider so it stops retrying. Log loudly so the
      // worker / Admin can investigate the dropped event.
      console.error(
        `[whatsapp.inbound] processing failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}
