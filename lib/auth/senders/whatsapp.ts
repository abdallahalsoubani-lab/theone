import { LanguagePref, WaTemplateApprovalStatus } from '@prisma/client';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { ConsoleOtpSender } from './console';
import type { OtpSender } from './types';

const OTP_TEMPLATE_NAME = 'otp_login';

/**
 * Is the `otp_login` template usable on the active provider right now?
 * Requires the row to exist and be active; on Meta it must also be APPROVED.
 * Returns false (rather than throwing) so the caller can fall back cleanly.
 */
async function isOtpTemplateSendable(): Promise<boolean> {
  const template = await db.whatsAppTemplate.findUnique({
    where: { name_language: { name: OTP_TEMPLATE_NAME, language: LanguagePref.EN } },
    select: { active: true, metaApprovalStatus: true },
  });
  if (!template || !template.active) return false;
  if (env.WHATSAPP_PROVIDER === 'meta') {
    return template.metaApprovalStatus === WaTemplateApprovalStatus.APPROVED;
  }
  return true;
}

/**
 * Production OTP sender.
 *
 * Active when `OTP_SENDER=whatsapp`. Enqueues onto the `whatsappOutbound`
 * queue rather than calling the provider directly so retries, rate
 * limiting, and audit are uniform with every other outbound (reminders,
 * credentials, confirmations). The recipient sees a real WhatsApp
 * message containing the OTP through whichever provider WHATSAPP_PROVIDER
 * resolves to.
 *
 * Template: `otp_login` (LanguagePref-aware). The OTP is the single body
 * parameter; the template body reads
 *   "Your Theone.pt login code is {{1}}. It expires in 5 minutes."
 *
 * Language defaults to EN — the patient phone number doesn't carry a
 * language preference, so the caller (the auth route) picks based on
 * cookie / accept-language. v1 keeps the simple default.
 */
export const WhatsAppOtpSender: OtpSender = {
  id: 'whatsapp',
  async sendOtp(phone, otp) {
    // Phase-two deferral: `otp_login` is not yet a live Meta template. If it
    // isn't sendable on the active provider, fall back to the console sender
    // so login still works (and the code is never silently lost) instead of
    // enqueuing a job the worker can only fail. Re-enabling is a single
    // `active` toggle once the template is approved in Meta.
    if (!(await isOtpTemplateSendable())) {
      console.warn(
        `[auth] ${OTP_TEMPLATE_NAME} template unavailable on provider=${env.WHATSAPP_PROVIDER} — falling back to console OTP`,
      );
      await ConsoleOtpSender.sendOtp(phone, otp);
      return;
    }

    await enqueueWhatsappOutbound({
      kind: 'template',
      templateName: OTP_TEMPLATE_NAME,
      language: LanguagePref.EN,
      parameters: [otp],
      recipientPhone: phone,
      // OTP recipients are pre-authentication; we don't know the User id
      // yet (and the OTP may target an unregistered phone). Skip linking.
      recipientUserId: null,
      source: 'queue',
    });
  },
};
