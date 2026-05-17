import { randomInt } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { redis } from '@/lib/redis/client';

import { otpSender } from './senders';

const OTP_TTL_SECONDS = 300; // 5 minutes — Prompt 4 §4.6
const OTP_COOLDOWN_SECONDS = 60; // one request per phone per minute
const OTP_MAX_ATTEMPTS = 3;
const OTP_BCRYPT_COST = 8; // 6-digit code, internal Redis storage — cost 8 is plenty
const OTP_DIGITS = 6;

const otpKey = (phone: string) => `otp:${phone}`;
const cooldownKey = (phone: string) => `otp:cooldown:${phone}`;

interface StoredOtp {
  codeHash: string;
  attempts: number;
}

export type OtpRequestResult =
  | { ok: true; cooldownSeconds: number }
  | { ok: false; reason: 'COOLDOWN'; retryAfterSeconds: number };

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'OTP_EXPIRED' | 'OTP_INVALID' | 'OTP_LOCKED'; attemptsLeft?: number };

/**
 * Request an OTP for the given phone. Always returns an `ok: true` shape after
 * the cooldown check passes, even if no user exists with that phone — leaking
 * "this phone has no account" via this endpoint would let attackers enumerate
 * patients. The eventual `verifyOtp` call surfaces nothing (the OTP never
 * existed) by returning `OTP_EXPIRED`, identical to a real-but-expired key.
 */
export async function requestOtp(phone: string): Promise<OtpRequestResult> {
  const remaining = await redis.ttl(cooldownKey(phone));
  if (remaining > 0) {
    return { ok: false, reason: 'COOLDOWN', retryAfterSeconds: remaining };
  }

  const otp = generateOtp();
  const codeHash = await bcrypt.hash(otp, OTP_BCRYPT_COST);
  const payload: StoredOtp = { codeHash, attempts: 0 };

  await redis
    .multi()
    .set(otpKey(phone), JSON.stringify(payload), 'EX', OTP_TTL_SECONDS)
    .set(cooldownKey(phone), '1', 'EX', OTP_COOLDOWN_SECONDS)
    .exec();

  await otpSender.sendOtp(phone, otp);
  return { ok: true, cooldownSeconds: OTP_COOLDOWN_SECONDS };
}

/**
 * Verify a code. Deletes the key on success or after 3 failures so the same
 * code can never be reused.
 */
export async function verifyOtp(phone: string, code: string): Promise<OtpVerifyResult> {
  const raw = await redis.get(otpKey(phone));
  if (!raw) return { ok: false, reason: 'OTP_EXPIRED' };

  const stored: StoredOtp = JSON.parse(raw);
  const ok = await bcrypt.compare(code, stored.codeHash);
  if (ok) {
    await redis.del(otpKey(phone));
    return { ok: true };
  }

  const attempts = stored.attempts + 1;
  if (attempts >= OTP_MAX_ATTEMPTS) {
    await redis.del(otpKey(phone));
    return { ok: false, reason: 'OTP_LOCKED' };
  }

  // Preserve TTL when re-writing the attempt counter.
  const ttl = await redis.ttl(otpKey(phone));
  await redis.set(
    otpKey(phone),
    JSON.stringify({ ...stored, attempts }),
    'EX',
    ttl > 0 ? ttl : OTP_TTL_SECONDS,
  );
  return { ok: false, reason: 'OTP_INVALID', attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
}

/** Wipes any existing OTP for the phone — used after a successful sign-in path. */
export async function clearOtp(phone: string): Promise<void> {
  await redis.del(otpKey(phone));
}

function generateOtp(): string {
  // 6 random digits, zero-padded. crypto.randomInt is cryptographically secure.
  const n = randomInt(0, 10 ** OTP_DIGITS);
  return n.toString().padStart(OTP_DIGITS, '0');
}
