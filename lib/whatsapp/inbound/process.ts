import { AppointmentStatus, AuditAction } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { queueRedis } from '@/lib/queue/client';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { groupAdjacentAppointments } from '@/lib/arrivals/grouping';
import { HUMAN_REPLY_SUPPRESSION_MS } from '@/lib/whatsapp/inbox/queries';
import { createNotification } from '@/lib/notifications/actions';
import { clinicHm, clinicWeekdayName } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';

import { parseIntentWithButtons } from './parser';
import type { WebhookEvent } from '../provider';
import { patientDisplayName } from '@/lib/format/patientName';

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
  // P50: a phone may belong to SEVERAL patients (a parent's number shared
  // across children), so the reply resolves across ALL of them — the target
  // is the nearest upcoming appointment that actually had a reminder sent,
  // searched over every patient on the number.
  const users = await db.user.findMany({
    where: { phone: args.fromPhone, deletedAt: null },
    select: { id: true, languagePref: true, fullNameEn: true, fullNameAr: true },
  });
  const first = users[0];
  const base: ReplyTargets = {
    recipientId: users.length === 1 ? first!.id : null,
    language: first?.languagePref === 'AR' ? 'AR' : 'EN',
    patientNameEn: first?.fullNameEn ?? '',
    patientNameAr: first?.fullNameAr ?? '',
    appointmentId: null,
    runAppointmentIds: [],
  };
  if (users.length === 0) return base;

  const now = new Date();
  const upcoming = await db.appointment.findMany({
    where: {
      patientId: { in: users.map((u) => u.id) },
      status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
      startsAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
    },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, durationMinutes: true, patientId: true },
    take: 40,
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

  // Prefer the nearest appointment that had a reminder actually sent —
  // across the whole family; the 48b reminder→appointmentId linkage is what
  // disambiguates WHICH child the reply concerns.
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
  const owner = users.find((u) => u.id === target.patientId) ?? first!;

  // The reply covers the whole zero-gap run around the target (P27 mirror)
  // — scoped to the SAME patient: a sibling's adjacent booking is a separate
  // confirmation, never swept up by this one (48b same-patient semantics).
  const ownAppointments = actionable.filter((a) => a.patientId === target.patientId);
  const runs = groupAdjacentAppointments(ownAppointments);
  const run = runs.find((r) => r.some((a) => a.id === target.id)) ?? [target];

  return {
    recipientId: owner.id,
    language: owner.languagePref === 'AR' ? 'AR' : 'EN',
    patientNameEn: owner.fullNameEn,
    patientNameAr: owner.fullNameAr,
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

  // Prompt 49 — thread bookkeeping: one thin conversation row per phone.
  // lastInboundAt anchors the 24h free-text window + the unread badge.
  const conversation = await db.whatsAppConversation.upsert({
    where: { phone: args.fromPhone },
    update: {
      lastInboundAt: args.receivedAt,
      lastMessageAt: args.receivedAt,
      ...(link.recipientId ? { patientId: link.recipientId } : {}),
    },
    create: {
      phone: args.fromPhone,
      patientId: link.recipientId,
      lastInboundAt: args.receivedAt,
      lastMessageAt: args.receivedAt,
    },
    select: { id: true, lastHumanReplyAt: true },
  });
  // A human replied in the last hour → suppress AUTO ACK MESSAGES only;
  // status transitions (confirm) must never be blocked by suppression.
  const acksSuppressed =
    conversation.lastHumanReplyAt !== null &&
    Date.now() - conversation.lastHumanReplyAt.getTime() < HUMAN_REPLY_SUPPRESSION_MS;

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
        ackSuppressed: acksSuppressed,
      });
      break;
    case 'RESCHEDULE_REQUEST':
      await handleRescheduleRequest({
        appointmentId: link.appointmentId,
        recipientId: link.recipientId,
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
        ackSuppressed: acksSuppressed,
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
  /** P49: a human replied <1h ago — skip the ACK message only; the status
   *  transition above always happens regardless. */
  ackSuppressed?: boolean;
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
  // confirms AND idempotent re-confirms (polite either way). P49: skipped
  // when a human replied within the last hour (the human owns the thread).
  if (args.ackSuppressed) return;
  // P51 — silent mode SUPPRESSES button acks entirely (an ack sent days
  // later is meaningless — logged, never held).
  if (await (await import('@/lib/whatsapp/silent-mode')).isSilentModeOn()) {
    console.warn('[silent-mode] confirm ack suppressed');
    return;
  }
  const isAr = targets.language === 'AR';
  const name = patientDisplayName(targets.patientNameEn, targets.patientNameAr, isAr ? 'ar' : 'en');
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
  // Owner ruling (P49 follow-up): the ONLY auto-replies are the confirm ack
  // and the decline ack. The old reschedule ack is removed — the request
  // lands unread in the WhatsApp Inbox and a human answers it.
}

async function handleCancelRequest(args: {
  targets: ReplyTargets;
  recipientPhone: string;
  messageId: string;
  body: string;
  ackSuppressed?: boolean;
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

  // Decline ack (48b §3.3) in the patient's language — P49: suppressed for
  // 1h after a manual reply (the inbox item + notification above still fire).
  if (args.ackSuppressed) return;
  // P51 — silent mode suppresses this ack too (logged, never held).
  if (await (await import('@/lib/whatsapp/silent-mode')).isSilentModeOn()) {
    console.warn('[silent-mode] decline ack suppressed');
    return;
  }
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
  // Prompt 49: the 48b soft generic is REMOVED — unrecognized messages now
  // land UNREAD in the WhatsApp Inbox where a human reads and answers.
  // No auto-reply of any kind fires here.
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
