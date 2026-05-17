'use server';

import { z } from 'zod';

import { requestOtp } from '@/lib/auth/otp';
import { AUTH_ERRORS, fail, ok, type Result } from '@/lib/auth/result';

const phoneSchema = z.object({
  phone: z.string().regex(/^\+9627\d{8}$/),
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
