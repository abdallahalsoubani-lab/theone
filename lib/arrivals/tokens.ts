import { randomBytes } from 'node:crypto';

import { db } from '@/lib/db';

/**
 * Access tokens for the two public arrivals surfaces (Prompt 18 §1, §4).
 *
 * The kiosk (patient-facing iPad) and the lobby display (staff break-room TV)
 * live in DIFFERENT trust zones, so each has its own token stored on
 * `ClinicSettings`. A token is a 32-char url-safe random string; null means
 * that surface is disabled. Generation/revocation is admin-only (see
 * `lib/arrivals/actions.ts`); validation is done by the public routes.
 */

export type ArrivalsSurface = 'kiosk' | 'display';

/** 24 random bytes → 32 url-safe chars. Plenty of entropy, no padding. */
export function generateAccessToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Resolve the clinic settings row a token unlocks, or null. Matching is a DB
 * equality on a unique-indexed column, so there is no JS-side string compare to
 * leak timing — and an empty/garbage token simply matches nothing.
 *
 * A non-empty token is required: we never let `null === null` open the gate.
 */
export async function validateArrivalsToken(
  surface: ArrivalsSurface,
  token: string | undefined | null,
): Promise<boolean> {
  if (!token || token.length < 16) return false;
  const where = surface === 'kiosk' ? { kioskToken: token } : { displayToken: token };
  const match = await db.clinicSettings.findFirst({ where, select: { id: true } });
  return Boolean(match);
}
