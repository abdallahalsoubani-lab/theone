'use server';

import { AuthError } from 'next-auth';
import { headers } from 'next/headers';
import { z } from 'zod';

import { signIn } from '@/auth';
import { db } from '@/lib/db';
import { evaluateLockout, lookupPatientByPhone, lookupStaffByEmail } from '@/lib/auth/lockout';
import { verifyOtp } from '@/lib/auth/otp';
import {
  listPickableProfiles,
  mintProfilePickToken,
  peekProfilePickToken,
  type PickableProfile,
} from '@/lib/auth/profile-pick';
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
  /** Where to go after sign-in. Null ONLY when `pick` is set (P57). */
  redirectTo: string | null;
  /** P57 — the OTP verified on a SHARED family number: no session yet; the
   *  form shows these profiles and finishes with `signInAsPickedPatient`. */
  pick?: { token: string; patients: PickableProfile[] };
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
 *
 * Single active patient on the phone: unchanged since Prompt 4 — the
 * provider verifies the OTP and signs them in.
 *
 * P57 — several active patients share the phone (a family number): the OTP
 * is verified HERE (consumed once, same attempt cap), no session is created,
 * and the caller receives a 2-minute single-use pick token + the profiles;
 * `signInAsPickedPatient` completes the login as the chosen patient. The
 * per-user lockout counters are not touched on this branch (there is no
 * single user to attribute a miss to); the OTP's own 3-attempt cap and the
 * per-IP rate limit still apply.
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
  if (pre.outcome === 'AMBIGUOUS') {
    const verified = await verifyOtp(parsed.data.phone, parsed.data.otp);
    if (!verified.ok) {
      return fail(
        verified.reason === 'OTP_EXPIRED'
          ? AUTH_ERRORS.OTP_EXPIRED
          : verified.reason === 'OTP_LOCKED'
            ? AUTH_ERRORS.OTP_LOCKED
            : AUTH_ERRORS.INVALID_OTP,
      );
    }
    const [token, patients] = await Promise.all([
      mintProfilePickToken(parsed.data.phone),
      listPickableProfiles(parsed.data.phone),
    ]);
    return ok({ redirectTo: null, pick: { token, patients } });
  }
  if (pre.outcome === 'ONE' && evaluateLockout(pre.user).status === 'LOCKED') {
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
      if (post.outcome === 'AMBIGUOUS') return fail(AUTH_ERRORS.PHONE_AMBIGUOUS);
      if (post.outcome === 'ONE' && evaluateLockout(post.user).status === 'LOCKED') {
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

const pickInputSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  patientId: z.string().min(1),
});

/**
 * P57 — step 3 for shared numbers: open the chosen profile. The token is
 * peeked here for friendly errors and CONSUMED by the provider, which
 * re-checks that the patient is active and holds that phone.
 */
export async function signInAsPickedPatient(input: {
  token: string;
  patientId: string;
}): Promise<Result<LoginSuccess>> {
  const parsed = pickInputSchema.safeParse(input);
  if (!parsed.success) return fail(AUTH_ERRORS.PICK_INVALID);

  const ip = await getClientIp();
  const rl = await rateLimit(`ratelimit:login:${ip}`, 5, 60);
  if (!rl.allowed) return fail(AUTH_ERRORS.RATE_LIMITED);

  const phone = await peekProfilePickToken(parsed.data.token);
  if (!phone) return fail(AUTH_ERRORS.PICK_INVALID);

  const target = await db.user.findFirst({
    where: { id: parsed.data.patientId, phone, role: 'PATIENT', deletedAt: null },
    select: { id: true, lockedUntil: true, failedLoginAttempts: true, mustChangePassword: true },
  });
  if (!target) return fail(AUTH_ERRORS.PICK_INVALID);
  if (evaluateLockout(target).status === 'LOCKED') return fail(AUTH_ERRORS.ACCOUNT_LOCKED);

  try {
    await signIn('phone-otp', {
      phone,
      pickToken: parsed.data.token,
      patientId: parsed.data.patientId,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) return fail(AUTH_ERRORS.PICK_INVALID);
    throw err;
  }

  const redirectTo = target.mustChangePassword ? '/change-password' : ROLE_HOME.PATIENT;
  return ok({ redirectTo });
}

async function getClientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
}
