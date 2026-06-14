'use server';

import { headers } from 'next/headers';

import { fail, ok, type Result } from '@/lib/auth/result';
import { rateLimit } from '@/lib/auth/rate-limit';

import { SUBMISSION_ERRORS, submissionToLocalized } from './errors';
import { publicSubmissionSchema } from './schemas';
import { createPublicSubmission } from './services';

/**
 * Public, UNAUTHENTICATED intake submission (Prompt 23 §3).
 *
 * Hardening, in order:
 *   1. IP rate-limit (Redis) — caps scripted floods.
 *   2. Payload-size cap — rejects oversized bodies before parsing.
 *   3. Honeypot (`website`) — a filled value is silently accepted (so a bot
 *      gets a 200 and no signal) but never stored.
 *   4. Full server-side Zod validation (never trust the client).
 *
 * Write-only: it can only create a PENDING submission. It never reads patient
 * data and never creates a patient (that happens on secretary approval).
 */

const MAX_SUBMISSIONS_PER_WINDOW = 5;
const RATE_WINDOW_SECONDS = 60 * 30; // 30 minutes
const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || 'unknown';
  return h.get('x-real-ip')?.trim() || 'unknown';
}

export async function submitPublicIntakeAction(input: unknown): Promise<Result<{ ok: true }>> {
  // 1. Rate-limit by IP.
  const ip = await clientIp();
  const rl = await rateLimit(
    `intake:submit:${ip}`,
    MAX_SUBMISSIONS_PER_WINDOW,
    RATE_WINDOW_SECONDS,
  );
  if (!rl.allowed) return fail(SUBMISSION_ERRORS.RATE_LIMITED);

  // 2. Payload size guard.
  try {
    if (JSON.stringify(input ?? {}).length > MAX_PAYLOAD_BYTES) {
      return fail(SUBMISSION_ERRORS.TOO_LARGE);
    }
  } catch {
    return fail(SUBMISSION_ERRORS.TOO_LARGE);
  }

  // 3. Honeypot — pretend success, store nothing.
  if (
    input &&
    typeof input === 'object' &&
    typeof (input as { website?: unknown }).website === 'string' &&
    (input as { website: string }).website.length > 0
  ) {
    return ok({ ok: true });
  }

  // 4. Validate + persist.
  const parsed = publicSubmissionSchema.safeParse(input);
  if (!parsed.success) return fail(submissionToLocalized(parsed.error));
  try {
    await createPublicSubmission(parsed.data);
    return ok({ ok: true });
  } catch (err) {
    return fail(submissionToLocalized(err));
  }
}
