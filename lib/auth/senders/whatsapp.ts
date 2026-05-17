import { NotImplementedError, type OtpSender } from './types';

/**
 * Production OTP sender — stub.
 *
 * Prompt 8 replaces this with the real Meta/Twilio WhatsApp client. The
 * file path and the export name are stable so swapping the implementation
 * touches one file. Keep the contract — never inline the OTP send from
 * outside `lib/auth/senders/`.
 */
export const WhatsAppOtpSender: OtpSender = {
  id: 'whatsapp',
  async sendOtp(_phone, _otp) {
    throw new NotImplementedError(
      'WhatsAppOtpSender: real WhatsApp delivery is implemented in Prompt 8. ' +
        'In dev set OTP_SENDER=console; in production complete the WhatsApp setup ' +
        'and replace this stub.',
    );
  },
};
