import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { patientDisplayName } from '@/lib/format/patientName';
import { unusedLinkForAppointment } from '@/lib/intake-links/queries';
import { isTemplateApproved } from './approval';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { RECIPIENT_PATIENT_SELECT, getMessageRecipients } from '@/lib/whatsapp/manual/recipients';

import { getAppointmentTherapistLabel } from './therapistLabel';
import type { ComposedMessage, SendOutcome, SenderSendOptions } from './types';
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

interface ComposeArgs {
  appointmentId: string;
  /** P61 — which patient of the appointment to address. Omitted = the single
   *  recipient (today's behaviour for SESSION/STRETCHING); required to pick a
   *  member of a GROUP. An id that is not on the appointment composes nothing. */
  recipientId?: string;
  /** P59 — an admin pressed Send in the outbox: attempt the send even when
   *  the patient is flagged whatsappReachable=false (the flag may be stale —
   *  a success flips it back). A missing phone still throws so the dispatch
   *  ledger records FAILED instead of a silent "SENT". */
  force?: boolean;
}

/**
 * Booking-confirmation composition (P53, split out in P60): re-reads the
 * appointment at fire time (the deferral contract: the patient always gets
 * the CURRENT details), picks the template (combined new-patient frame while
 * an unused intake link exists AND the frame is approved, else the standard
 * confirmation) and builds the parameters from the registry variable shape.
 * Returns null when the message must not go out (cancelled / started / no
 * phone / unreachable without `force`).
 */
export async function composeAppointmentConfirmation(
  args: ComposeArgs,
): Promise<ComposedMessage | null> {
  const appt = await db.appointment.findUnique({
    where: { id: args.appointmentId },
    include: {
      patient: { select: RECIPIENT_PATIENT_SELECT },
      // P61 — a GROUP keeps its patients in the M2M; the scalar relation is
      // empty there, which is why this composer used to return null for one.
      groupPatients: {
        orderBy: { createdAt: 'asc' },
        select: { checkedInAt: true, patient: { select: RECIPIENT_PATIENT_SELECT } },
      },
      therapists: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
      },
    },
  });
  if (!appt) return null;
  const recipients = getMessageRecipients(appt);
  const recipient = args.recipientId
    ? (recipients.find((r) => r.id === args.recipientId) ?? null)
    : (recipients[0] ?? null);
  if (!recipient) return null;
  if (appt.status !== 'SCHEDULED' && appt.status !== 'CONFIRMED') {
    console.warn(
      `[lifecycle] appointment ${args.appointmentId} status=${appt.status} — confirmation skipped`,
    );
    return null;
  }
  if (appt.startsAt.getTime() <= Date.now()) {
    console.warn(`[lifecycle] appointment ${args.appointmentId} already started — skipped`);
    return null;
  }
  const p = recipient;
  if (!p.phone) {
    if (args.force) throw new Error('patient has no phone number');
    return null;
  }
  if (!p.whatsappReachable && !args.force) return null;

  const isAr = p.languagePref === 'AR';
  // P61 — the shared label (first-of-N / clinic-team fallback). `appointmentType`
  // is deliberately NOT passed: this template's therapist-less wording has always
  // been «فريق العيادة» even for a STRETCHING booking, and it must stay identical.
  const therapistName = getAppointmentTherapistLabel({
    therapists: appt.therapists,
    language: p.languagePref,
  });

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
  // P61 — the personal intake link belongs to the booking's own patient; a
  // GROUP member must never receive someone else's link.
  const link = p.viaMembership ? null : await unusedLinkForAppointment(appt.id);
  const useCombined = link
    ? await isTemplateApproved(NEW_PATIENT_TEMPLATE_NAME, p.languagePref)
    : false;
  const templateName = useCombined ? NEW_PATIENT_TEMPLATE_NAME : TEMPLATE_NAME;

  const shape = await resolveTemplateShape(templateName, p.languagePref);
  if (!shape) {
    console.error(`[lifecycle] no variable shape for ${templateName} — skipping`);
    return null;
  }
  const ctx = await appointmentVarContext({
    startsAt: appt.startsAt,
    patientName: patientDisplayName(p.fullNameEn, p.fullNameAr, isAr ? 'ar' : 'en'),
    therapistName,
    language: p.languagePref,
    intakeUrl: useCombined && link ? intakeLinkUrl(link.token, p.languagePref) : undefined,
  });
  return {
    templateName,
    language: p.languagePref,
    parameters: buildParamsFromShape(shape, ctx),
    recipientPhone: p.phone,
    recipientUserId: p.id,
    appointmentId: appt.id,
  };
}

/**
 * Booking-confirmation sender (P53): the deferred lifecycle worker, the
 * outbox Send and the P60 manual panel all fire this. Compose, then enqueue
 * on the outbound queue (retries / rate limit / WhatsAppMessage row live in
 * the worker). Returns null when nothing was enqueued.
 */
export async function sendAppointmentConfirmation(
  args: ComposeArgs & SenderSendOptions,
): Promise<SendOutcome | null> {
  const composed = await composeAppointmentConfirmation(args);
  if (!composed) return null;
  const jobId = await enqueueWhatsappOutbound({
    kind: 'template',
    templateName: composed.templateName,
    language: composed.language,
    parameters: composed.parameters,
    recipientPhone: composed.recipientPhone,
    recipientUserId: composed.recipientUserId,
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
