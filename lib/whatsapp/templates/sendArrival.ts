import { db } from '@/lib/db';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { buildParamsFromShape, resolveTemplateShape } from './variables';

const TEMPLATE_NAME = 'arrival_confirmation';

/**
 * Arrival-confirmation sender (July 31 item 3). Fired once per arrival group
 * from the `notifyArrival` seam — kiosk and secretary manual check-in both
 * land here. `{{1}}` is the patient's FIRST name in their preferred
 * language; the body carries no appointment details, so no date/time
 * context is needed.
 *
 * The send is enqueued on the outbound WhatsApp queue like every other
 * template (retries, rate limiting, and `WhatsAppMessage` logging are the
 * worker's job) — never sent inline. Unreachable/phone-less patients are
 * skipped silently, matching the other senders.
 */
export async function sendArrivalConfirmation(args: {
  patientId: string;
  /** The appointments this one arrival covers; the first anchors the log row. */
  appointmentIds: string[];
}): Promise<void> {
  const patient = await db.user.findUnique({
    where: { id: args.patientId },
    select: {
      id: true,
      phone: true,
      languagePref: true,
      whatsappReachable: true,
      fullNameEn: true,
      fullNameAr: true,
    },
  });
  if (!patient?.whatsappReachable || !patient.phone) return;

  const isAr = patient.languagePref === 'AR';
  const fullName =
    (isAr ? patient.fullNameAr : patient.fullNameEn) || patient.fullNameEn || patient.fullNameAr;
  const firstName = fullName.trim().split(/\s+/)[0] ?? fullName;

  const shape = await resolveTemplateShape(TEMPLATE_NAME, patient.languagePref);
  if (!shape) {
    console.error('[arrival] no variable shape for the arrival template — skipping');
    return;
  }

  await enqueueWhatsappOutbound({
    kind: 'template',
    templateName: TEMPLATE_NAME,
    language: patient.languagePref,
    parameters: buildParamsFromShape(shape, {
      patientName: firstName,
      therapistName: '',
      date: '',
      time: '',
      dayName: '',
    }),
    recipientPhone: patient.phone,
    recipientUserId: patient.id,
    appointmentId: args.appointmentIds[0] ?? null,
    source: 'queue',
  });
}
