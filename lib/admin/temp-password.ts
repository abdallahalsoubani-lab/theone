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

/**
 * Readable staff password in `Word-Word-1234` form (Prompt 22 Part 1).
 *
 * Satisfies `passwordSchema`: capitalized words give upper+lower, the numeric
 * block gives digits, and `-` is in the allowed symbol set. Words are chosen
 * with `randomInt` (CSPRNG); ~64² × 9000 ≈ 36.8M combinations — fine for
 * demo-phase credentials that are also rate-limited + lockout-protected.
 */
const WORDS = [
  'Amber',
  'Aqua',
  'Aspen',
  'Atlas',
  'Basil',
  'Birch',
  'Blaze',
  'Bloom',
  'Breeze',
  'Brook',
  'Cedar',
  'Cliff',
  'Cloud',
  'Coral',
  'Crane',
  'Crest',
  'Dawn',
  'Delta',
  'Dune',
  'Ember',
  'Fern',
  'Flint',
  'Frost',
  'Galaxy',
  'Grove',
  'Harbor',
  'Hazel',
  'Iris',
  'Ivory',
  'Jade',
  'Juniper',
  'Lagoon',
  'Lark',
  'Lotus',
  'Maple',
  'Marble',
  'Meadow',
  'Mesa',
  'Mist',
  'Noble',
  'Oasis',
  'Ocean',
  'Onyx',
  'Opal',
  'Orbit',
  'Pearl',
  'Pine',
  'Plum',
  'Prism',
  'Quartz',
  'Raven',
  'Reef',
  'Ridge',
  'River',
  'Rowan',
  'Sage',
  'Sierra',
  'Slate',
  'Solar',
  'Spruce',
  'Stone',
  'Summit',
  'Terra',
  'Willow',
] as const;

export function generateReadablePassword(randomInt: (min: number, max: number) => number): string {
  const w1 = WORDS[randomInt(0, WORDS.length)]!;
  const w2 = WORDS[randomInt(0, WORDS.length)]!;
  const num = randomInt(1000, 10000);
  return `${w1}-${w2}-${num}`;
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
