import { db } from '@/lib/db';
import { RECIPIENT_PATIENT_SELECT } from '@/lib/whatsapp/manual/recipients';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { patientFirstName } from './firstName';
import type { ComposedMessage, SendOutcome, SenderSendOptions } from './types';
import { buildParamsFromShape, resolveTemplateShape } from './variables';

const TEMPLATE_NAME = 'arrival_confirmation';

interface ComposeArgs {
  patientId: string;
  /** The appointments this one arrival covers; the first anchors the log row. */
  appointmentIds: string[];
  /** P59 — outbox Send: bypass the stale whatsappReachable flag (see
   *  sendAppointmentConfirmation). */
  force?: boolean;
}

/**
 * Arrival-confirmation composition (July 31 item 3, split in P60). `{{1}}`
 * is the patient's FIRST name in their preferred language; the body carries
 * no appointment details, so no date/time context is needed.
 */
export async function composeArrivalConfirmation(
  args: ComposeArgs,
): Promise<ComposedMessage | null> {
  // P61 follow-up — these two senders address a patient DIRECTLY by id, so
  // they never touched the appointment's scalar relation and were never part
  // of the group-phone bug. They now share the one recipient column set so a
  // future column can't be added to some recipients and not others.
  const patient = await db.user.findUnique({
    where: { id: args.patientId },
    select: RECIPIENT_PATIENT_SELECT,
  });
  if (!patient?.phone) {
    if (args.force) throw new Error('patient has no phone number');
    return null;
  }
  if (!patient.whatsappReachable && !args.force) return null;

  const shape = await resolveTemplateShape(TEMPLATE_NAME, patient.languagePref);
  if (!shape) {
    console.error('[arrival] no variable shape for the arrival template — skipping');
    return null;
  }

  return {
    templateName: TEMPLATE_NAME,
    language: patient.languagePref,
    parameters: buildParamsFromShape(shape, {
      patientName: patientFirstName(patient),
      therapistName: '',
      date: '',
      time: '',
      dayName: '',
    }),
    recipientPhone: patient.phone,
    recipientUserId: patient.id,
    appointmentId: args.appointmentIds[0] ?? null,
  };
}

/**
 * Arrival-confirmation sender. Fired once per arrival group from the
 * `notifyArrival` seam — kiosk and secretary manual check-in both land here
 * — and by the outbox / P60 panel. The send is enqueued on the outbound
 * WhatsApp queue like every other template (retries, rate limiting, and
 * `WhatsAppMessage` logging are the worker's job) — never sent inline.
 * Unreachable/phone-less patients are skipped silently, matching the other
 * senders.
 */
export async function sendArrivalConfirmation(
  args: ComposeArgs & SenderSendOptions,
): Promise<SendOutcome | null> {
  const composed = await composeArrivalConfirmation(args);
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
