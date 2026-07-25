import { AppointmentStatus, type UserRole } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Reminder-confirmation tracking (Prompt 48b §3.6) — the surface that makes
 * the reminder's "no reply ⇒ the appointment will be cancelled" sentence
 * TRUE as a conscious human decision: NO automatic cancellation exists;
 * the secretary sees who hasn't replied and cancels through the normal
 * flow (reason dialog → WhatsApp cancellation template → audit → waitlist).
 *
 * Reply state is DERIVED — no schema field (documented 48b choice):
 *   CONFIRMED — the appointment status is CONFIRMED (button/text confirm
 *               flips it, and a manual secretary confirm counts the same);
 *   DECLINED  — an inbound CANCEL_REQUEST message is linked to it;
 *   NONE      — reminder sent, nothing recognizable back yet.
 */

/** Horizon: reminded appointments within the next N hours. Constant for
 *  now (48b: settings only if trivial — it wasn't; noted in the docs). */
export const CONFIRMATION_HORIZON_HOURS = 48;

export type ReminderReplyState = 'CONFIRMED' | 'DECLINED' | 'NONE';

export interface ReminderConfirmationRow {
  appointmentId: string;
  patientId: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  /** Secretary/Admin surface — phones visible (P15 applies only if DOCTOR
   *  is ever granted this page; it is not in 48b). */
  patientPhone: string | null;
  startsAt: Date;
  durationMinutes: number;
  seriesId: string | null;
  status: AppointmentStatus;
  therapists: { fullNameEn: string; fullNameAr: string }[];
  reminderSentAt: Date | null;
  replyState: ReminderReplyState;
  replyAt: Date | null;
}

/** Only SECRETARY + ADMIN see the list (48b §3.6 — doctor access optional
 *  and NOT granted; therapists never). */
export function canSeeConfirmationsList(role: UserRole): boolean {
  return role === 'SECRETARY' || role === 'ADMIN';
}

export async function listReminderConfirmations(
  now: Date = new Date(),
): Promise<ReminderConfirmationRow[]> {
  const horizonEnd = new Date(now.getTime() + CONFIRMATION_HORIZON_HOURS * 60 * 60 * 1000);

  // Scalar-patient appointments in the horizon that are still live. (GROUP
  // members get reminders too, but per-member confirm state on a shared
  // appointment is a different shape — v1 scopes to single-patient rows.)
  const appts = await db.appointment.findMany({
    where: {
      startsAt: { gte: now, lte: horizonEnd },
      status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
      patientId: { not: null },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      durationMinutes: true,
      seriesId: true,
      status: true,
      patient: {
        select: { id: true, fullNameEn: true, fullNameAr: true, phone: true },
      },
      therapists: {
        orderBy: { createdAt: 'asc' },
        select: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
      },
    },
  });
  if (appts.length === 0) return [];

  const ids = appts.map((a) => a.id);
  const messages = await db.whatsAppMessage.findMany({
    where: {
      appointmentId: { in: ids },
      OR: [
        { direction: 'OUTBOUND', template: { name: 'appointment_reminder_v2' } },
        { direction: 'INBOUND', intent: { in: ['CONFIRM', 'CANCEL_REQUEST'] } },
      ],
    },
    orderBy: { sentAt: 'asc' },
    select: {
      appointmentId: true,
      direction: true,
      intent: true,
      sentAt: true,
    },
  });

  const reminderAt = new Map<string, Date>();
  const confirmAt = new Map<string, Date>();
  const declineAt = new Map<string, Date>();
  for (const m of messages) {
    if (!m.appointmentId) continue;
    if (m.direction === 'OUTBOUND') {
      if (!reminderAt.has(m.appointmentId)) reminderAt.set(m.appointmentId, m.sentAt);
    } else if (m.intent === 'CONFIRM') {
      confirmAt.set(m.appointmentId, m.sentAt);
    } else if (m.intent === 'CANCEL_REQUEST') {
      declineAt.set(m.appointmentId, m.sentAt);
    }
  }

  return appts
    .filter((a) => reminderAt.has(a.id)) // the list is about REMINDED bookings
    .map((a) => {
      const confirmed = a.status === AppointmentStatus.CONFIRMED || confirmAt.has(a.id);
      const declined = !confirmed && declineAt.has(a.id);
      return {
        appointmentId: a.id,
        patientId: a.patient!.id,
        patientFullNameEn: a.patient!.fullNameEn,
        patientFullNameAr: a.patient!.fullNameAr,
        patientPhone: a.patient!.phone,
        startsAt: a.startsAt,
        durationMinutes: a.durationMinutes,
        seriesId: a.seriesId,
        status: a.status,
        therapists: a.therapists.map((t) => t.therapist),
        reminderSentAt: reminderAt.get(a.id) ?? null,
        replyState: confirmed ? 'CONFIRMED' : declined ? 'DECLINED' : 'NONE',
        replyAt: confirmAt.get(a.id) ?? declineAt.get(a.id) ?? null,
      } satisfies ReminderConfirmationRow;
    });
}

/** No-reply count for the sidebar badge (arrivals-badge precedent). */
export async function countUnconfirmedReminders(now: Date = new Date()): Promise<number> {
  const rows = await listReminderConfirmations(now);
  return rows.filter((r) => r.replyState === 'NONE').length;
}
