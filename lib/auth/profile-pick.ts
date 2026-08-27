import { randomBytes } from 'node:crypto';

import { UserRole } from '@prisma/client';

import { db } from '@/lib/db';
import { hasPlaceholderDob } from '@/lib/patients/placeholder-dob';
import { redis } from '@/lib/redis/client';

/**
 * P57 — patient OTP login on a SHARED family number.
 *
 * One phone may belong to several active patients (a mother and her two
 * children). The OTP is still one-per-phone; after it verifies, the login
 * cannot know which account to open, so the server mints a short-lived,
 * single-use PICK TOKEN bound to the phone and the form shows a profile
 * picker. Selecting a profile hands `{pickToken, patientId}` to the
 * `phone-otp` provider, which consumes the token and signs in exactly that
 * patient. Single-patient numbers never touch this module.
 *
 * Token: 32 random bytes (hex), Redis `otp:pick:{token}` → phone, TTL 120s,
 * deleted on first consume. The OTP itself was already consumed by the
 * verify step, so a stolen token alone cannot be replayed past its 2-minute
 * window and one use.
 */
const PICK_TTL_SECONDS = 120;
const pickKey = (token: string) => `otp:pick:${token}`;

export async function mintProfilePickToken(phone: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await redis.set(pickKey(token), phone, 'EX', PICK_TTL_SECONDS);
  return token;
}

/** Non-consuming read — for the server action's friendly pre-checks. */
export async function peekProfilePickToken(token: string): Promise<string | null> {
  if (!token) return null;
  return redis.get(pickKey(token));
}

/** Read AND delete — the provider's single-use consume. */
export async function consumeProfilePickToken(token: string): Promise<string | null> {
  if (!token) return null;
  const [got] = (await redis.multi().get(pickKey(token)).del(pickKey(token)).exec()) ?? [];
  const value = got?.[1];
  return typeof value === 'string' ? value : null;
}

export interface PickableProfile {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  /** Birth year to tell siblings with similar names apart; null while the
   *  DOB is still the P52 placeholder (quick-added, intake not filled). */
  dobYear: number | null;
}

/** Every ACTIVE patient on the phone — archived records never appear. */
export async function listPickableProfiles(phone: string): Promise<PickableProfile[]> {
  const rows = await db.user.findMany({
    where: { phone, deletedAt: null, role: UserRole.PATIENT },
    select: {
      id: true,
      fullNameEn: true,
      fullNameAr: true,
      patientProfile: { select: { dateOfBirth: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => {
    const dob = r.patientProfile?.dateOfBirth ?? null;
    return {
      id: r.id,
      fullNameEn: r.fullNameEn,
      fullNameAr: r.fullNameAr,
      dobYear: dob && !hasPlaceholderDob(dob) ? dob.getUTCFullYear() : null,
    };
  });
}
