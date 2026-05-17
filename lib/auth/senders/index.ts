import { ConsoleOtpSender } from './console';
import type { OtpSender } from './types';
import { WhatsAppOtpSender } from './whatsapp';

export type { OtpSender };
export { NotImplementedError } from './types';

/**
 * Resolve the active OTP sender from env. Logged once at module load so the
 * server boot log makes it obvious which channel is wired up.
 */
function resolveSender(): OtpSender {
  const choice = process.env.OTP_SENDER === 'whatsapp' ? 'whatsapp' : 'console';
  return choice === 'whatsapp' ? WhatsAppOtpSender : ConsoleOtpSender;
}

export const otpSender: OtpSender = resolveSender();

console.warn(`[auth] active OTP sender: ${otpSender.id}`);
