import { AppointmentStatus, AuditAction } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { queueRedis } from '@/lib/queue/client';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { groupAdjacentAppointments } from '@/lib/arrivals/grouping';
import { createNotification } from '@/lib/notifications/actions';
import { clinicHm, clinicWeekdayName } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';

import { parseIntentWithButtons } from './parser';
import type { WebhookEvent } from '../provider';

/**
 * Shared inbound webhook event processor. Wired from both
 * `/api/v1/whatsapp/webhook/twilio` and `/api/v1/whatsapp/webhook/meta`.
 *
 * Three event shapes flow through here, both providers normalized:
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

interface ReplyTargets {
  recipientId: string | null;
  language: 'AR' | 'EN';
  patientNameEn: string;
  patientNameAr: string;
  /** The appointment the reply concerns (nearest upcoming, reminded first). */
  appointmentId: string | null;
  /** The full back-to-back run containing it (Prompt 48b §2.3 — a confirm
   *  inside a run confirms the whole run, mirroring the P27 arrival rule). */
  runAppointmentIds: string[];
}

/**
 * Resolve which appointment(s) an inbound reply concerns (48b §2.3):
 *   1. patient by phone;
 *   2. their upcoming still-actionable appointments (SCHEDULED/CONFIRMED,
 *      scheduled end not passed);
 *   3. prefer the nearest one that actually HAD a reminder sent (an
 *      outbound row linked to it); fall back to the nearest upcoming, then
 *      to the legacy recent-outbound link for edge cases;
 *   4. expand to the back-to-back run (zero-gap) containing the target.
 */
async function resolveReplyTargets(args: { fromPhone: string }): Promise<ReplyTargets> {
  const user = await db.user.findFirst({
    where: { phone: args.fromPhone, deletedAt: null },
    select: { id: true, languagePref: true, fullNameEn: true, fullNameAr: true },
  });
  const base: ReplyTargets = {
    recipientId: user?.id ?? null,
    language: user?.languagePref === 'AR' ? 'AR' : 'EN',
    patientNameEn: user?.fullNameEn ?? '',
    patientNameAr: user?.fullNameAr ?? '',
    appointmentId: null,
    runAppointmentIds: [],
  };
  if (!user) return base;

  const now = new Date();
  const upcoming = await db.appointment.findMany({
    where: {
      patientId: user.id,
      status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
      startsAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
    },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, durationMinutes: true },
    take: 20,
  });
  const actionable = upcoming.filter(
    (a) => a.startsAt.getTime() + a.durationMinutes * 60_000 > now.getTime(),
  );
  if (actionable.length === 0) {
    // Legacy fallback: the most recent outbound with an appointment link
    // (covers e.g. a reply about an already-passed slot).
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
    return { ...base, appointmentId: recentOutbound?.appointmentId ?? null };
  }

  // Prefer the nearest appointment that had a reminder actually sent.
  const reminded = await db.whatsAppMessage.findMany({
    where: {
      direction: 'OUTBOUND',
      appointmentId: { in: actionable.map((a) => a.id) },
      template: { name: 'appointment_reminder_v2' },
    },
    select: { appointmentId: true },
  });
  const remindedIds = new Set(reminded.map((m) => m.appointmentId));
  const target = actionable.find((a) => remindedIds.has(a.id)) ?? actionable[0]!;

  // The reply covers the whole zero-gap run around the target (P27 mirror).
  const runs = groupAdjacentAppointments(actionable);
  const run = runs.find((r) => r.some((a) => a.id === target.id)) ?? [target];

  return {
    ...base,
    appointmentId: target.id,
    runAppointmentIds: run.map((a) => a.id),
  };
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
  buttonPayload?: string;
  buttonText?: string;
}): Promise<void> {
  const intent = parseIntentWithButtons(args);
  const link = await resolveReplyTargets({ fromPhone: args.fromPhone });

  const inserted = await db.whatsAppMessage.create({
    data: {
      direction: 'INBOUND',
      status: 'DELIVERED',
      recipientPhone: args.fromPhone,
      recipientId: link.recipientId,
      providerMessageId: args.providerMessageId,
      body: args.body || args.buttonText || '',
      parameters: (args.buttonPayload
        ? { buttonPayload: args.buttonPayload }
        : {}) as Prisma.InputJsonValue,
      intent,
      appointmentId: link.appointmentId,
      sentAt: args.receivedAt,
    },
    select: { id: true },
  });

  switch (intent) {
    case 'CONFIRM':
      await handleConfirm({
        targets: link,
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
        targets: link,
        recipientPhone: args.fromPhone,
        messageId: inserted.id,
        body: args.body || args.buttonText || '',
      });
      break;
    case 'UNKNOWN':
    default:
      await handleUnknown({
        recipientId: link.recipientId,
        language: link.language,
        appointmentId: link.appointmentId,
        recipientPhone: args.fromPhone,
        messageId: inserted.id,
        body: args.body,
      });
  }
}

async function handleConfirm(args: {
  targets: ReplyTargets;
  recipientPhone: string;
  messageId: string;
}): Promise<void> {
  const { targets } = args;
  if (!targets.appointmentId || !targets.recipientId) {
    // No appointment to confirm against — drop in the inbox as UNKNOWN
    // so the Secretary triages.
    await db.inboxItem.create({
      data: {
        type: 'INBOUND_UNKNOWN',
        patientId: targets.recipientId,
        messageId: args.messageId,
        note: 'CONFIRM with no matched appointment',
      },
    });
    return;
  }

  // Confirm the whole zero-gap run (48b §2.3, mirroring the P27 arrival
  // rule): each still-SCHEDULED occurrence flips to CONFIRMED, audited with
  // the patient as actor (authenticated implicitly via the signed webhook).
  const runIds = targets.runAppointmentIds.length
    ? targets.runAppointmentIds
    : [targets.appointmentId];
  const run = await db.appointment.findMany({
    where: { id: { in: runIds } },
    select: { id: true, status: true, patientId: true },
  });
  if (run.length === 0) return;

  // A confirm can never resurrect a terminal booking (cancelled/completed/
  // no-show): nothing changes and — documented choice — we stay SILENT
  // rather than send a misleading "confirmed" ack; the row still lands in
  // the technical log, and the P49 Inbox will surface the conversation.
  const anyActionable = run.some(
    (a) => a.status === AppointmentStatus.SCHEDULED || a.status === AppointmentStatus.CONFIRMED,
  );
  if (!anyActionable) return;

  for (const appt of run) {
    if (appt.status !== AppointmentStatus.SCHEDULED) continue; // idempotent
    await db.appointment.update({
      where: { id: appt.id },
      data: { status: AppointmentStatus.CONFIRMED },
    });
    await db.auditLog.create({
      data: {
        actorId: appt.patientId ?? targets.recipientId,
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

  // New ack wording (48b §1.6) in the patient's language — sent for fresh
  // confirms AND idempotent re-confirms (polite either way).
  const isAr = targets.language === 'AR';
  const name = isAr ? targets.patientNameAr : targets.patientNameEn;
  await enqueueWhatsappOutbound({
    kind: 'text',
    body: isAr
      ? `مرحباً ${name}، تم التأكيد على موعدكم. نتمنى لكم دوام الصحة والعافية.`
      : `Hello ${name}, your appointment is confirmed. We wish you continued health and wellness.`,
    language: targets.language,
    recipientPhone: args.recipientPhone,
    recipientUserId: targets.recipientId,
    appointmentId: targets.appointmentId,
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
    appointmentId: args.appointmentId ?? undefined,
    source: 'inbound_ack',
  });
}

async function handleCancelRequest(args: {
  targets: ReplyTargets;
  recipientPhone: string;
  messageId: string;
  body: string;
}): Promise<void> {
  const { targets } = args;
  // 48b DECLINE flow — NO auto-cancellation anywhere. The decline is
  // DERIVED state: this inbound row (intent=CANCEL_REQUEST + appointmentId)
  // is what the Unconfirmed list queries — no schema field needed
  // (documented lighter-mechanism choice).
  await db.inboxItem.create({
    data: {
      type: 'INBOUND_CANCEL_REQUEST',
      patientId: targets.recipientId,
      appointmentId: targets.appointmentId,
      messageId: args.messageId,
      note: args.body.slice(0, 280),
    },
  });

  // In-app notification to every SECRETARY + ADMIN (48b §3.3), naming the
  // patient + the clinic-wall day/time of the declined appointment.
  if (targets.appointmentId) {
    const appt = await db.appointment.findUnique({
      where: { id: targets.appointmentId },
      select: { startsAt: true },
    });
    if (appt) {
      const tz = await getClinicTimeZone();
      const staff = await db.user.findMany({
        where: { role: { in: ['SECRETARY', 'ADMIN'] }, deletedAt: null },
        select: { id: true, languagePref: true },
      });
      await Promise.all(
        staff.map((u) =>
          createNotification({
            recipientId: u.id,
            type: 'PATIENT_DECLINED_APPOINTMENT',
            params: {
              patientName:
                u.languagePref === 'AR'
                  ? targets.patientNameAr || targets.patientNameEn
                  : targets.patientNameEn || targets.patientNameAr,
              day: clinicWeekdayName(appt.startsAt, u.languagePref === 'AR' ? 'ar' : 'en', tz),
              time: clinicHm(appt.startsAt, tz),
            },
            linkPath: '/secretary/confirmations',
            relatedEntityType: 'Appointment',
            relatedEntityId: targets.appointmentId ?? undefined,
          }).catch((err: unknown) =>
            console.error('[whatsapp.inbound] decline notification failed', err),
          ),
        ),
      );
    }
  }

  // Decline ack (48b §3.3) in the patient's language.
  const isAr = targets.language === 'AR';
  await enqueueWhatsappOutbound({
    kind: 'text',
    body: isAr
      ? 'شكراً لإبلاغنا — سيتواصل معكم فريق الاستقبال لإعادة التنسيق.'
      : 'Thank you for letting us know — our reception team will contact you to rearrange.',
    language: targets.language,
    recipientPhone: args.recipientPhone,
    recipientUserId: targets.recipientId,
    appointmentId: targets.appointmentId,
    source: 'inbound_ack',
  });
}

const GENERIC_REPLY_KEY = (phone: string) => `wa:generic-ack:${phone}`;
const GENERIC_REPLY_TTL_SECONDS = 60 * 60 * 24; // once per 24h window per phone

async function handleUnknown(args: {
  recipientId: string | null;
  language: 'AR' | 'EN';
  appointmentId: string | null;
  recipientPhone: string;
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
  // P49 SEAM: the WhatsApp Inbox will consume these unrecognized messages
  // as conversation threads; a human/manual outbound path (none exists
  // yet) should then suppress this generic.

  // 48b §3.4 — soft generic, AT MOST once per 24h per phone, registered
  // patients only (unknown numbers stay silent), never the word "confirmed".
  if (!args.recipientId) return;
  const first = await queueRedis.set(
    GENERIC_REPLY_KEY(args.recipientPhone),
    '1',
    'EX',
    GENERIC_REPLY_TTL_SECONDS,
    'NX',
  );
  if (first !== 'OK') return; // already acked within the window
  const isAr = args.language === 'AR';
  await enqueueWhatsappOutbound({
    kind: 'text',
    body: isAr
      ? 'شكراً لرسالتكم — سيطّلع عليها فريق الاستقبال ويرد عليكم قريباً.'
      : 'Thank you for your message — our reception team will review it and get back to you shortly.',
    language: args.language,
    recipientPhone: args.recipientPhone,
    recipientUserId: args.recipientId,
    appointmentId: args.appointmentId ?? undefined,
    source: 'inbound_ack',
  });
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
