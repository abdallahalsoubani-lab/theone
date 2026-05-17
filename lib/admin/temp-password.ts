import { randomBytes } from 'node:crypto';

/**
 * 12-character temporary password that satisfies the password policy.
 *
 * Composition guarantees at least one of each required class so the resulting
 * string passes `passwordSchema` without retries. Used when an admin creates
 * a staff user or forces a password reset — the plaintext appears once on
 * the success screen and is never persisted.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+';
const POOL = UPPER + LOWER + DIGITS + SYMBOLS;

function pick(set: string, bytes: Buffer, offset: number): string {
  const byte = bytes[offset] ?? 0;
  return set.charAt(byte % set.length);
}

export function generateTempPassword(length = 12): string {
  if (length < 8) throw new Error('temp password length must be >= 8');
  const bytes = randomBytes(length * 2);
  const chars: string[] = [];
  // Guarantee one of each class first.
  chars.push(pick(UPPER, bytes, 0));
  chars.push(pick(LOWER, bytes, 1));
  chars.push(pick(DIGITS, bytes, 2));
  chars.push(pick(SYMBOLS, bytes, 3));
  for (let i = chars.length; i < length; i++) {
    chars.push(pick(POOL, bytes, i + 4));
  }
  // Fisher–Yates shuffle so the guaranteed-class chars aren't always at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = (bytes[i + length] ?? 0) % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
