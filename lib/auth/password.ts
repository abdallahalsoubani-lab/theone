import bcrypt from 'bcryptjs';
import { z } from 'zod';

/**
 * Password policy — Prompt 4 §4.8.
 *
 *   ≥ 8 characters
 *   ≥ 1 uppercase letter
 *   ≥ 1 lowercase letter
 *   ≥ 1 digit
 *   ≥ 1 symbol from the allowed set
 */
const SYMBOLS = '!@#$%^&*()_+\\-=\\[\\]{}|;:,.<>?';

export const passwordSchema = z
  .string()
  .min(8, 'WEAK_PASSWORD')
  .regex(/[A-Z]/, 'WEAK_PASSWORD')
  .regex(/[a-z]/, 'WEAK_PASSWORD')
  .regex(/\d/, 'WEAK_PASSWORD')
  .regex(new RegExp(`[${SYMBOLS}]`), 'WEAK_PASSWORD');

export const BCRYPT_COST = 12; // Prompt 0 §3 / spec §6 security row

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
