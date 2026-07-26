import { db } from '@/lib/db';
import { patientDisplayName } from '@/lib/format/patientName';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { appointmentVarContext, buildParamsFromShape, resolveTemplateShape } from './variables';

const TEMPLATE_NAME = 'appointment_confirmation_v2';

/**
 * Booking-confirmation sender (P53): extracted from the inline
 * createAppointment block so the deferred lifecycle worker can fire it, and
 * FIXED en route (§2.4): parameters now come from the registry variable
 * shape like the reschedule sender — no more hardcoded order, so a SID/
 * shape switch needs zero deploy.
 *
 * Re-reads the appointment at fire time (the deferral contract: the patient
 * always gets the CURRENT details) and skips silently when it was cancelled
 * or already started during the wait — the cancel path removes the pending
 * job anyway; this is the belt to that suspender.
 */
export async function sendAppointmentConfirmation(args: { appointmentId: string }): Promise<void> {
  const appt = await db.appointment.findUnique({
    where: { id: args.appointmentId },
    include: {
      patient: {
        select: {
          id: true,
          phone: true,
          languagePref: true,
          whatsappReachable: true,
          fullNameEn: true,
          fullNameAr: true,
        },
      },
      therapists: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
      },
    },
  });
  if (!appt || !appt.patient) return;
  if (appt.status !== 'SCHEDULED' && appt.status !== 'CONFIRMED') {
    console.warn(
      `[lifecycle] appointment ${args.appointmentId} status=${appt.status} — confirmation skipped`,
    );
    return;
  }
  if (appt.startsAt.getTime() <= Date.now()) {
    console.warn(`[lifecycle] appointment ${args.appointmentId} already started — skipped`);
    return;
  }
  const p = appt.patient;
  if (!p.whatsappReachable || !p.phone) return;

  const isAr = p.languagePref === 'AR';
  const therapist = appt.therapists[0]?.therapist ?? null;
  const therapistName = therapist
    ? isAr
      ? therapist.fullNameAr
      : therapist.fullNameEn
    : isAr
      ? 'فريق العيادة'
      : 'the clinic team';
  const shape = await resolveTemplateShape(TEMPLATE_NAME, p.languagePref);
  if (!shape) {
    console.error('[lifecycle] no variable shape for confirmation template — skipping');
    return;
  }
  const ctx = await appointmentVarContext({
    startsAt: appt.startsAt,
    patientName: patientDisplayName(p.fullNameEn, p.fullNameAr, isAr ? 'ar' : 'en'),
    therapistName,
    language: p.languagePref,
  });
  await enqueueWhatsappOutbound({
    kind: 'template',
    templateName: TEMPLATE_NAME,
    language: p.languagePref,
    parameters: buildParamsFromShape(shape, ctx),
    recipientPhone: p.phone,
    recipientUserId: p.id,
    appointmentId: appt.id,
    source: 'queue',
  });
}

/**
 * "Was the confirmation ever actually SENT for this appointment?" —
 * §3.3's lighter mechanism (no schema): the stored outbound message row is
 * the truth. Drives the send-kind on reschedule: never got the confirmation
 * → the patient gets a (new-details) CONFIRMATION, not a reschedule notice.
 */
export async function confirmationAlreadySent(appointmentId: string): Promise<boolean> {
  const row = await db.whatsAppMessage.findFirst({
    where: {
      appointmentId,
      direction: 'OUTBOUND',
      status: { not: 'FAILED' },
      template: { name: TEMPLATE_NAME },
    },
    select: { id: true },
  });
  return row !== null;
}
