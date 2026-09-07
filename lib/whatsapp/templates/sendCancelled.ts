import type { CancellationCategory } from '@prisma/client';

import { db } from '@/lib/db';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { clinicDateKey, clinicHm } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';

import type { ComposedMessage, SendOutcome, SenderSendOptions } from './types';

const TEMPLATE_NAME = 'appointment_cancelled_v2';

/**
 * Localized label for a cancellation category — the third template variable.
 * Moved here from lib/appointments/services.ts in P48 so the deferred/manual
 * dispatch worker and the appointment services share one copy.
 */
export function categoryLabelForLocale(
  category: CancellationCategory,
  language: 'EN' | 'AR',
): string {
  const labels: Record<CancellationCategory, { en: string; ar: string }> = {
    PATIENT_REQUEST: { en: 'patient request', ar: 'طلب المريض' },
    PATIENT_NO_SHOW: { en: 'patient no-show', ar: 'عدم حضور المريض' },
    PATIENT_ILLNESS: { en: 'patient illness', ar: 'مرض المريض' },
    PATIENT_TRAVEL: { en: 'patient travel', ar: 'سفر المريض' },
    CLINIC_RESCHEDULING: { en: 'clinic rescheduling', ar: 'إعادة جدولة العيادة' },
    THERAPIST_UNAVAILABLE: { en: 'therapist unavailable', ar: 'المعالج غير متاح' },
    WEATHER: { en: 'weather', ar: 'ظروف جوية' },
    INSURANCE_ISSUE: { en: 'insurance issue', ar: 'مشكلة تأمين' },
    OTHER: { en: 'other', ar: 'أخرى' },
  };
  const l = labels[category];
  return language === 'AR' ? l.ar : l.en;
}

interface ComposeArgs {
  appointmentId: string;
  /** P59 — outbox Send: bypass the stale whatsappReachable flag (see
   *  sendAppointmentConfirmation). */
  force?: boolean;
}

/**
 * Cancellation-message composition (P48, split in P60): re-reads the
 * appointment at fire time — it must actually BE cancelled (an un-cancel/
 * rebook during a wait means the pending job was already removed by the
 * dispatch layer; this is the belt to that suspender), and the category/time
 * come from the row, never from a stale snapshot. The three parameters are
 * fixed in code (date / time / reason) — the v1 body still live in Twilio.
 */
export async function composeAppointmentCancelled(
  args: ComposeArgs,
): Promise<ComposedMessage | null> {
  const appt = await db.appointment.findUnique({
    where: { id: args.appointmentId },
    select: {
      id: true,
      startsAt: true,
      status: true,
      cancellationCategory: true,
      patientId: true,
      patient: {
        select: { id: true, phone: true, languagePref: true, whatsappReachable: true },
      },
    },
  });
  if (!appt || !appt.patient) return null;
  if (appt.status !== 'CANCELLED') {
    console.warn(
      `[dispatch] appointment ${args.appointmentId} status=${appt.status} — cancellation message skipped`,
    );
    return null;
  }
  const p = appt.patient;
  if (!p.phone) {
    if (args.force) throw new Error('patient has no phone number');
    return null;
  }
  if (!p.whatsappReachable && !args.force) return null;

  const tz = await getClinicTimeZone();
  return {
    templateName: TEMPLATE_NAME,
    language: p.languagePref,
    parameters: [
      clinicDateKey(appt.startsAt, tz),
      clinicHm(appt.startsAt, tz),
      categoryLabelForLocale(appt.cancellationCategory ?? 'OTHER', p.languagePref),
    ],
    recipientPhone: p.phone,
    recipientUserId: appt.patientId ?? null,
    appointmentId: appt.id,
  };
}

/**
 * Cancellation-message sender (P48): one sender for the deferred (AUTO
 * delay) path, the manual outbox, and the P60 panel — mirroring
 * sendConfirmation / sendRescheduled.
 */
export async function sendAppointmentCancelled(
  args: ComposeArgs & SenderSendOptions,
): Promise<SendOutcome | null> {
  const composed = await composeAppointmentCancelled(args);
  if (!composed) return null;
  const jobId = await enqueueWhatsappOutbound({
    kind: 'template',
    templateName: composed.templateName,
    language: composed.language,
    parameters: composed.parameters,
    recipientPhone: composed.recipientPhone,
    recipientUserId: composed.recipientUserId ?? undefined,
    appointmentId: composed.appointmentId,
    source: args.source ?? 'queue',
    sentById: args.sentById ?? null,
  });
  return {
    jobId,
    templateName: composed.templateName,
    language: composed.language,
    recipientUserId: composed.recipientUserId,
  };
}
