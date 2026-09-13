'use server';

import { z } from 'zod';

import { normalizePhoneStrict } from '@/lib/format/phone-validate';

import { requestOtp } from '@/lib/auth/otp';
import { AUTH_ERRORS, fail, ok, type Result } from '@/lib/auth/result';

const phoneSchema = z.object({
  // P61 item 2 — was /^\+9627\d{8}$/ (Jordan only): a patient the clinic can
  // register with a foreign number must also be able to log in with it. The
  // shared parser decides validity; a bare `07…` is still read as Jordanian.
  phone: z
    .string()
    .transform((v) => normalizePhoneStrict(v))
    .refine((v): v is string => v !== null, 'phoneInvalid'),
});

interface OtpRequestSuccess {
  cooldownSeconds: number;
}

/**
 * Request a one-time code. Always returns ok:true past the cooldown check
 * even if the phone has no account — preventing patient-enumeration via the
 * request endpoint. The eventual verifyOtp call returns OTP_EXPIRED in that
 * case, identical to a real-but-expired key.
 */
export async function requestOtpAction(input: {
  phone: string;
}): Promise<Result<OtpRequestSuccess>> {
  const parsed = phoneSchema.safeParse(input);
  if (!parsed.success) return fail(AUTH_ERRORS.INVALID_OTP);

  const result = await requestOtp(parsed.data.phone);
  if (!result.ok) {
    return fail({
      ...AUTH_ERRORS.OTP_COOLDOWN,
      details: { retryAfterSeconds: result.retryAfterSeconds },
    });
  }
  return ok({ cooldownSeconds: result.cooldownSeconds });
}
