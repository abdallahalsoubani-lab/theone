import { db } from '@/lib/db';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { isTemplateApproved } from './approval';
import { patientFirstName } from './firstName';
import type { ComposedMessage, SendOutcome, SenderSendOptions } from './types';
import { buildParamsFromShape, resolveTemplateShape } from './variables';

/** P60 — the manual custom-message frame (see lib/admin/whatsapp/custom-message-template.ts). */
export const CUSTOM_MESSAGE_TEMPLATE = 'clinic_custom_message';

interface ComposeArgs {
  patientId: string;
  /** Anchors the log row to the appointment the secretary was looking at. */
  appointmentId: string | null;
  /** Already normalized by lib/whatsapp/manual/customText.ts. */
  text: string;
  /** Human-initiated by definition — the stale whatsappReachable flag never
   *  blocks it; a missing phone throws so the caller reports a real error. */
  force?: boolean;
}

/**
 * Custom-message composition: `{{1}}` first name in the patient's language,
 * `{{2}}` the secretary's text. Returns null when the frame is not yet
 * approved for that language (the panel hides the type in that case; this
 * is the server-side belt).
 */
export async function composeCustomMessage(args: ComposeArgs): Promise<ComposedMessage | null> {
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
  if (!patient?.phone) {
    if (args.force) throw new Error('patient has no phone number');
    return null;
  }
  if (!patient.whatsappReachable && !args.force) return null;
  if (!(await isTemplateApproved(CUSTOM_MESSAGE_TEMPLATE, patient.languagePref))) return null;

  const shape = await resolveTemplateShape(CUSTOM_MESSAGE_TEMPLATE, patient.languagePref);
  if (!shape) {
    console.error('[manual] no variable shape for the custom-message template — skipping');
    return null;
  }
  return {
    templateName: CUSTOM_MESSAGE_TEMPLATE,
    language: patient.languagePref,
    parameters: buildParamsFromShape(shape, {
      patientName: patientFirstName(patient),
      customText: args.text,
      therapistName: '',
      date: '',
      time: '',
      dayName: '',
    }),
    recipientPhone: patient.phone,
    recipientUserId: patient.id,
    appointmentId: args.appointmentId,
  };
}

export async function sendCustomMessage(
  args: ComposeArgs & SenderSendOptions,
): Promise<SendOutcome | null> {
  const composed = await composeCustomMessage(args);
  if (!composed) return null;
  const jobId = await enqueueWhatsappOutbound({
    kind: 'template',
    templateName: composed.templateName,
    language: composed.language,
    parameters: composed.parameters,
    recipientPhone: composed.recipientPhone,
    recipientUserId: composed.recipientUserId,
    appointmentId: composed.appointmentId,
    source: args.source ?? 'manual_panel',
    sentById: args.sentById ?? null,
  });
  return {
    jobId,
    templateName: composed.templateName,
    language: composed.language,
    recipientUserId: composed.recipientUserId,
  };
}
