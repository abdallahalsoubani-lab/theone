import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { patientDisplayName } from '@/lib/format/patientName';
import { unusedLinkForAppointment } from '@/lib/intake-links/queries';
import { isTemplateApproved } from './approval';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { appointmentVarContext, buildParamsFromShape, resolveTemplateShape } from './variables';

const TEMPLATE_NAME = 'appointment_confirmation_v2';
/** P52 — the combined confirmation used ONLY for a new-patient booking that
 *  still has an unused personal intake link (date + time + the link). */
const NEW_PATIENT_TEMPLATE_NAME = 'new_patient_confirmation';

/** Build the public tokenized intake URL for a patient's language. */
function intakeLinkUrl(token: string, language: 'AR' | 'EN'): string {
  const base = (env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/${language === 'AR' ? 'ar' : 'en'}/intake/link/${token}`;
}

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
export async function sendAppointmentConfirmation(args: {
  appointmentId: string;
  /** P59 — an admin pressed Send in the outbox: attempt the send even when
   *  the patient is flagged whatsappReachable=false (the flag may be stale —
   *  a success flips it back). A missing phone still throws so the dispatch
   *  ledger records FAILED instead of a silent "SENT". */
  force?: boolean;
}): Promise<void> {
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
  if (!p.phone) {
    if (args.force) throw new Error('patient has no phone number');
    return;
  }
  if (!p.whatsappReachable && !args.force) return;

  const isAr = p.languagePref === 'AR';
  const therapist = appt.therapists[0]?.therapist ?? null;
  const therapistName = therapist
    ? isAr
      ? therapist.fullNameAr
      : therapist.fullNameEn
    : isAr
      ? 'فريق العيادة'
      : 'the clinic team';

  // P52 — a new-patient booking carries an UNUSED personal intake link. When
  // present, the patient's ONE message is the combined template (date + time
  // + link) INSTEAD of the standard confirmation (owner decision 6). Every
  // other booking is untouched. The dispatch/hold/silent path is identical —
  // only the template name + one extra variable differ.
  //
  // P52 deploy — the combined template can only be used once WhatsApp
  // APPROVES it (a pending template fails to send). Until then, a new-patient
  // booking falls back to the standard approved confirmation (no inline
  // link; the link still lives on the patient file for the secretary to
  // send). The daily approval-sync flips this automatically.
  const link = await unusedLinkForAppointment(appt.id);
  const useCombined = link
    ? await isTemplateApproved(NEW_PATIENT_TEMPLATE_NAME, p.languagePref)
    : false;
  const templateName = useCombined ? NEW_PATIENT_TEMPLATE_NAME : TEMPLATE_NAME;

  const shape = await resolveTemplateShape(templateName, p.languagePref);
  if (!shape) {
    console.error(`[lifecycle] no variable shape for ${templateName} — skipping`);
    return;
  }
  const ctx = await appointmentVarContext({
    startsAt: appt.startsAt,
    patientName: patientDisplayName(p.fullNameEn, p.fullNameAr, isAr ? 'ar' : 'en'),
    therapistName,
    language: p.languagePref,
    intakeUrl: useCombined && link ? intakeLinkUrl(link.token, p.languagePref) : undefined,
  });
  await enqueueWhatsappOutbound({
    kind: 'template',
    templateName,
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
