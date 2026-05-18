import { LanguagePref } from '@prisma/client';

import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import type { OtpSender } from './types';

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
    await enqueueWhatsappOutbound({
      kind: 'template',
      templateName: 'otp_login',
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
