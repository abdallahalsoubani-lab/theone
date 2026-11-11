'use server';

import { headers } from 'next/headers';

import { fail, ok, type Result } from '@/lib/auth/result';
import { rateLimit } from '@/lib/auth/rate-limit';

import { IntakeError } from '@/lib/intake/errors';
import { prefixIntakeDetails } from '@/lib/intake-submissions/errors';

import { IntakeLinkSubmitError, submitIntakeViaLink } from './submit';

/**
 * P52 — public, UNAUTHENTICATED submit of a personal intake via its token.
 * Same hardening posture as the walk-in public intake: IP rate-limit +
 * payload cap + full server-side Zod (in the service). Tokens are secrets:
 * never logged in full, never returned in any error.
 *
 * All failure modes (unknown / used / mismatched / malformed token, bad
 * payload) collapse to ONE neutral localized message — the page must not
 * reveal whether a token ever existed.
 */

const MAX_PER_WINDOW = 8;
const WINDOW_SECONDS = 60 * 30;
const MAX_PAYLOAD_BYTES = 64 * 1024;

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || 'unknown';
  return h.get('x-real-ip')?.trim() || 'unknown';
}

const NEUTRAL = {
  code: 'INTAKE_LINK_INVALID',
  message_en: 'This link is no longer valid. Please contact the reception desk.',
  message_ar: 'هذا الرابط لم يعد صالحاً — يرجى مراجعة الاستقبال.',
} as const;

/**
 * P64 #9 — a payload problem is NOT a dead link. Telling a patient with a
 * missing answer "this link is no longer valid" made them give up — the
 * intake "never arrived". Validation failures now say what is wrong; only
 * genuine link failures (unknown / used / mismatched token) stay neutral.
 */
const CHECK_ANSWERS = {
  code: 'VALIDATION',
  message_en: 'Some answers are missing or invalid — please check the form and try again.',
  message_ar: 'بعض الإجابات ناقصة أو غير صحيحة — يرجى مراجعة النموذج والمحاولة مرة أخرى.',
} as const;

const RATE_LIMITED = {
  code: 'RATE_LIMITED',
  message_en: 'Too many attempts. Please wait a moment and try again.',
  message_ar: 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
} as const;

export async function submitIntakeViaLinkAction(input: unknown): Promise<Result<{ ok: true }>> {
  const ip = await clientIp();
  const rl = await rateLimit(`intake-link:submit:${ip}`, MAX_PER_WINDOW, WINDOW_SECONDS);
  if (!rl.allowed) return fail(RATE_LIMITED);

  try {
    if (JSON.stringify(input ?? {}).length > MAX_PAYLOAD_BYTES) return fail(NEUTRAL);
  } catch {
    return fail(NEUTRAL);
  }

  try {
    const data = await submitIntakeViaLink(input);
    return ok(data);
  } catch (err) {
    // Missing required answers — field-level details for the form.
    if (err instanceof IntakeError) return fail(prefixIntakeDetails(err.error));
    // A malformed payload is the patient's form, not the link (P64 #9).
    if (err instanceof IntakeLinkSubmitError && err.code === 'VALIDATION') {
      return fail(CHECK_ANSWERS);
    }
    // Never leak which link failure occurred — one opaque message.
    if (err instanceof IntakeLinkSubmitError) return fail(NEUTRAL);
    console.error('[intake-link] submit failed', err);
    return fail(NEUTRAL);
  }
}
