/**
 * OTP delivery contract.
 *
 * Prompt 4 ships two implementations: `ConsoleOtpSender` (dev, logs to stdout)
 * and `WhatsAppOtpSender` (production stub, throws `NotImplementedError` —
 * Prompt 8 replaces it). The selector in `./index.ts` picks one from
 * `process.env.OTP_SENDER`.
 *
 * Every other module in the app depends on this interface, not on a concrete
 * implementation, so swapping Twilio for Meta in Prompt 8 is one file change.
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
