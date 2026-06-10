/**
 * OTP delivery contract.
 *
 * Two implementations: `ConsoleOtpSender` (dev, logs to stdout) and
 * `WhatsAppOtpSender` (enqueues via the active WhatsApp provider). The
 * selector in `./index.ts` picks one from `process.env.OTP_SENDER`.
 *
 * Every other module depends on this interface, not on a concrete
 * implementation, so swapping the delivery channel is one file change.
 */
export interface OtpSender {
  readonly id: string;
  sendOtp(phone: string, otp: string): Promise<void>;
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
