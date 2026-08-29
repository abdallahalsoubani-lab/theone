/**
 * Jordan phone formatter.
 *
 * Accepts the common input shapes and normalises to E.164-with-spaces:
 *   "962790123456"    -> "+962 79 012 3456"
 *   "+962790123456"   -> "+962 79 012 3456"
 *   "0790123456"      -> "+962 79 012 3456"
 *   "00962790123456"  -> "+962 79 012 3456"
 *
 * The output is wrapped in Unicode LRM markers (‎) so it renders LTR
 * even when embedded inside Arabic prose (otherwise the leading `+962` gets
 * pulled into RTL context and the digits jumble visually).
 *
 * Unrecognised input is returned untouched (still LRM-wrapped). Better than
 * throwing — a slightly weird number is more useful in the UI than an empty
 * span.
 */
const LRM = '‎';

/**
 * Normalise a Jordanian mobile to the canonical E.164 form the system stores
 * on `User.phone` (`+9627XXXXXXXX`). Mirrors the shapes `formatPhone` accepts —
 * `790123456`, `0790123456`, `962790123456`, `+962790123456`, `00962…` — but
 * returns the bare canonical string for equality matching (kiosk check-in,
 * lookups), or `null` when the input is not a valid Jordan mobile.
 *
 * Jordan mobiles are `+9627[7-9]XXXXXXX` (the national number after `962` is
 * `7` followed by 8 digits). We deliberately reject anything that does not
 * resolve to that 9-digit national number so a typo can never silently match
 * the wrong patient.
 */
export function normalizeJordanPhone(input: string): string | null {
  const digits = input.replace(/\D+/g, '');

  let national: string | null = null; // the `7XXXXXXXX` part (9 digits)
  if (digits.startsWith('00962') && digits.length === 14) {
    national = digits.slice(5);
  } else if (digits.startsWith('962') && digits.length === 12) {
    national = digits.slice(3);
  } else if (digits.startsWith('0') && digits.length === 10) {
    national = digits.slice(1);
  } else if (digits.length === 9) {
    national = digits;
  }

  if (!national || !/^7\d{8}$/.test(national)) return null;
  return `+962${national}`;
}

/**
 * P58 item 3 — normalise a NON-Jordanian number to canonical E.164.
 *
 * Tolerates the separators people paste (spaces, dashes, dots, parentheses)
 * and the `00` international prefix, then validates strict E.164. Returns
 * the canonical `+<digits>` string, or `null` when the input is not a valid
 * international number (letters, missing country code, wrong length).
 *
 * The root cause this closes: the quick-add booking path stored a pasted
 * `+972 52-505-4631` verbatim, and Twilio rejected `whatsapp:+972 52-…`
 * with error 21211 — the only international send failures in production
 * history all traced to that one stored string.
 */
export function normalizeInternationalPhone(input: string): string | null {
  let s = input.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/**
 * THE storage normaliser (P58 item 3): the one chain every phone-accepting
 * entry point runs before writing `User.phone`. Jordanian convenience shapes
 * first (`07…`, `7…`, `962…`, `00962…` → `+9627XXXXXXXX` — unchanged UX),
 * then general international E.164 with separator tolerance. `null` = not
 * storable; the caller rejects with the `phoneE164` message.
 */
export function normalizePhoneForStorage(input: string): string | null {
  return normalizeJordanPhone(input) ?? normalizeInternationalPhone(input);
}

export function formatPhone(input: string | null | undefined): string {
  // P50: patient phone is optional — every display surface renders the
  // shared em-dash placeholder rather than crashing or showing blank.
  if (!input || !input.trim()) return '—';
  const digits = input.replace(/\D+/g, '');

  // Normalise to a country-code-led 12-digit Jordanian mobile string.
  let canonical: string | null = null;
  if (digits.startsWith('962') && digits.length === 12) {
    canonical = digits;
  } else if (digits.startsWith('00962') && digits.length === 14) {
    canonical = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 10) {
    canonical = `962${digits.slice(1)}`;
  }

  if (!canonical) {
    return `${LRM}${input.trim()}${LRM}`;
  }

  const country = canonical.slice(0, 3); // 962
  const prefix = canonical.slice(3, 5); // 77, 78, 79
  const part1 = canonical.slice(5, 8);
  const part2 = canonical.slice(8, 12);
  return `${LRM}+${country} ${prefix} ${part1} ${part2}${LRM}`;
}
