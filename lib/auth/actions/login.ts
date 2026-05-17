'use server';

import { AuthError } from 'next-auth';
import { headers } from 'next/headers';
import { z } from 'zod';

import { signIn } from '@/auth';
import { db } from '@/lib/db';
import { evaluateLockout, lookupPatientByPhone, lookupStaffByEmail } from '@/lib/auth/lockout';
import { rateLimit } from '@/lib/auth/rate-limit';
import { AUTH_ERRORS, fail, ok, type Result } from '@/lib/auth/result';
import { ROLE_HOME } from '@/lib/auth/routes';

const credentialsInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const phoneOtpInputSchema = z.object({
  phone: z.string().regex(/^\+9627\d{8}$/),
  otp: z.string().regex(/^\d{6}$/),
});

interface LoginSuccess {
  redirectTo: string;
}

/**
 * Staff login via email + password.
 *
 * Sequence (Prompt 4 §4.4, §4.15):
 *   1. IP rate limit — 5 / 60s
 *   2. Pre-check lockout (so a locked user gets ACCOUNT_LOCKED even with the
 *      correct password)
 *   3. signIn('credentials') — provider runs the bcrypt compare + lockout writes
 *   4. Post-check lockout (failure on the 10th attempt sets lockedUntil; show
 *      ACCOUNT_LOCKED rather than INVALID_CREDENTIALS for that one)
 */
export async function loginWithCredentials(input: {
  email: string;
  password: string;
}): Promise<Result<LoginSuccess>> {
  const parsed = credentialsInputSchema.safeParse(input);
  if (!parsed.success) return fail(AUTH_ERRORS.INVALID_CREDENTIALS);

  const ip = await getClientIp();
  const rl = await rateLimit(`ratelimit:login:${ip}`, 5, 60);
  if (!rl.allowed) return fail(AUTH_ERRORS.RATE_LIMITED);

  const pre = await lookupStaffByEmail(parsed.data.email);
  if (pre && evaluateLockout(pre).status === 'LOCKED') {
    return fail(AUTH_ERRORS.ACCOUNT_LOCKED);
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // Re-check lockout — the provider may have just locked the account.
      const post = await lookupStaffByEmail(parsed.data.email);
      if (post && evaluateLockout(post).status === 'LOCKED') {
        return fail(AUTH_ERRORS.ACCOUNT_LOCKED);
      }
      return fail(AUTH_ERRORS.INVALID_CREDENTIALS);
    }
    throw err;
  }

  // signIn returns successfully — fetch the role for redirect routing.
  const user = await db.user.findFirst({
    where: { email: parsed.data.email.toLowerCase(), deletedAt: null },
    select: { role: true, mustChangePassword: true },
  });
  if (!user) return fail(AUTH_ERRORS.INVALID_CREDENTIALS);
  const redirectTo = user.mustChangePassword ? '/change-password' : ROLE_HOME[user.role];
  return ok({ redirectTo });
}

/**
 * Patient login — step 2 of the OTP flow (step 1 = `requestOtpAction`).
 */
export async function verifyOtpAndSignIn(input: {
  phone: string;
  otp: string;
}): Promise<Result<LoginSuccess>> {
  const parsed = phoneOtpInputSchema.safeParse(input);
  if (!parsed.success) return fail(AUTH_ERRORS.INVALID_OTP);

  const ip = await getClientIp();
  const rl = await rateLimit(`ratelimit:login:${ip}`, 5, 60);
  if (!rl.allowed) return fail(AUTH_ERRORS.RATE_LIMITED);

  const pre = await lookupPatientByPhone(parsed.data.phone);
  if (pre && evaluateLockout(pre).status === 'LOCKED') {
    return fail(AUTH_ERRORS.ACCOUNT_LOCKED);
  }

  try {
    await signIn('phone-otp', {
      phone: parsed.data.phone,
      otp: parsed.data.otp,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      const post = await lookupPatientByPhone(parsed.data.phone);
      if (post && evaluateLockout(post).status === 'LOCKED') {
        return fail(AUTH_ERRORS.ACCOUNT_LOCKED);
      }
      return fail(AUTH_ERRORS.INVALID_OTP);
    }
    throw err;
  }

  const user = await db.user.findFirst({
    where: { phone: parsed.data.phone, deletedAt: null },
    select: { mustChangePassword: true },
  });
  const redirectTo = user?.mustChangePassword ? '/change-password' : ROLE_HOME.PATIENT;
  return ok({ redirectTo });
}

async function getClientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}
