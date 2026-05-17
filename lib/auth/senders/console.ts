import type { OtpSender } from './types';

/**
 * Development OTP sender — writes the code to stderr with a prominent marker.
 * QA can grep the dev log for `[DEV OTP]` instead of needing a real phone.
 *
 * NEVER active in production: the env validator (`lib/env.ts`) only allows
 * 'console' or 'whatsapp', and `getOtpSender()` defaults to WhatsApp when
 * NODE_ENV=production unless the operator explicitly opts out.
 */
export const ConsoleOtpSender: OtpSender = {
  id: 'console',
  async sendOtp(phone, otp) {
    console.warn(`[DEV OTP] phone=${phone} otp=${otp}`);
  },
};
