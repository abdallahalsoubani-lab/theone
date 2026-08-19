import { UserRole } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Per-account lockout state on the User row.
 *
 *   failedLoginAttempts < threshold  → increment on miss
 *   failedLoginAttempts == threshold → set lockedUntil = now + window, reset counter
 *   successful login                 → clear both
 *
 * The patient OTP provider uses the same fields so a phishing-OTP brute force
 * also triggers lockout (separate from the OTP_LOCKED short-window block).
 */
export const LOCKOUT_THRESHOLD = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export type LockoutCheck = { status: 'OK' } | { status: 'LOCKED'; unlocksAt: Date };

export function evaluateLockout(user: { lockedUntil: Date | null }): LockoutCheck {
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return { status: 'LOCKED', unlocksAt: user.lockedUntil };
  }
  return { status: 'OK' };
}

export async function recordFailedAttempt(userId: string): Promise<{ locked: boolean }> {
  const updated = await db.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });
  if (updated.failedLoginAttempts >= LOCKOUT_THRESHOLD) {
    await db.user.update({
      where: { id: userId },
      data: {
        lockedUntil: new Date(Date.now() + LOCKOUT_WINDOW_MS),
        failedLoginAttempts: 0,
      },
    });
    return { locked: true };
  }
  return { locked: false };
}

export async function recordSuccessfulAttempt(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
}

/**
 * Look up a user by email for the Credentials provider. Returns null for
 * deleted users, patients (they use OTP), or unknown emails — same nullness
 * either way so the caller produces an identical INVALID_CREDENTIALS error.
 */
export async function lookupStaffByEmail(email: string) {
  const lower = email.trim().toLowerCase();
  return db.user.findFirst({
    where: {
      email: lower,
      deletedAt: null,
      role: { not: UserRole.PATIENT },
    },
  });
}

/**
 * Look up a patient by phone for the OTP provider.
 *
 * P50 (revised, §5.2): patient phones are no longer unique — families share
 * one number. When more than one active patient matches, the login must be
 * REFUSED rather than silently authenticating whichever row happens to sort
 * first, so the result is a three-way outcome instead of user-or-null.
 */
export type PatientPhoneLookup =
  | { outcome: 'NONE' }
  | { outcome: 'AMBIGUOUS' }
  | { outcome: 'ONE'; user: NonNullable<Awaited<ReturnType<typeof findPatientsByPhone>>[number]> };

function findPatientsByPhone(phone: string) {
  return db.user.findMany({
    where: {
      phone,
      deletedAt: null,
      role: UserRole.PATIENT,
    },
    // Two rows are enough to prove ambiguity.
    take: 2,
  });
}

export async function lookupPatientByPhone(phone: string): Promise<PatientPhoneLookup> {
  const matches = await findPatientsByPhone(phone);
  const [single] = matches;
  if (!single) return { outcome: 'NONE' };
  if (matches.length > 1) return { outcome: 'AMBIGUOUS' };
  return { outcome: 'ONE', user: single };
}
