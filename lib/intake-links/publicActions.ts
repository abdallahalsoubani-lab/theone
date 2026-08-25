'use server';

import { headers } from 'next/headers';

import { fail, ok, type Result } from '@/lib/auth/result';
import { rateLimit } from '@/lib/auth/rate-limit';

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
    // Never leak which failure occurred — one opaque message.
    if (err instanceof IntakeLinkSubmitError) return fail(NEUTRAL);
    console.error('[intake-link] submit failed', err);
    return fail(NEUTRAL);
  }
}
