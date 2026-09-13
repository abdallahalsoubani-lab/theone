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
 * P61 item 2 — fold Eastern-Arabic (٠١٢…) and Persian (۰۱۲…) digits to ASCII.
 * The clinic types in Arabic, and an Arabic-Indic phone number used to be
 * rejected everywhere because every normaliser started from `\D+` stripping,
 * which treats those code points as non-digits.
 */
export function foldEasternDigits(input: string): string {
  return input.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

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
  const digits = foldEasternDigits(input).replace(/\D+/g, '');

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
  let s = foldEasternDigits(input)
    .trim()
    .replace(/[\s\-().]/g, '');
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
  const digits = foldEasternDigits(input).replace(/\D+/g, '');

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

/**
 * P61 item 2 §2.3.3 — THE display formatter for a stored patient phone.
 *
 * Jordanian numbers keep the familiar national grouping («+962 79 012 3456»);
 * anything foreign is grouped as «+<country> <rest in 3s/4s>» instead of being
 * dumped raw, so a US number reads as +1 415 555 2671 in lists, panels and
 * exports alike. Always LRM-wrapped so the leading + survives Arabic prose.
 *
 * `locale` is accepted for symmetry with the other formatters (and so a future
 * locale-specific grouping is a one-file change); the grouping itself is
 * locale-independent today — a phone number reads the same in both catalogs.
 */
export function formatPatientPhone(
  phone: string | null | undefined,
  _locale?: 'en' | 'ar',
): string {
  if (!phone || !phone.trim()) return '—';
  const jordan = normalizeJordanPhone(phone);
  if (jordan) return formatPhone(jordan);

  const intl = normalizeInternationalPhone(phone);
  if (!intl) return `${LRM}${phone.trim()}${LRM}`;

  // Split the country calling code off, then group the rest in readable runs.
  const digits = intl.slice(1);
  const cc = CALLING_CODE_LENGTHS.find((len) => KNOWN_CALLING_CODES.has(digits.slice(0, len))) ?? 1;
  const country = digits.slice(0, cc);
  const rest = digits.slice(cc);
  const groups = rest.length > 7 ? [rest.slice(0, 3), rest.slice(3, 6), rest.slice(6)] : [rest];
  return `${LRM}+${country} ${groups.filter(Boolean).join(' ')}${LRM}`;
}

/**
 * The calling codes the clinic actually sees, longest-first, so the display
 * formatter splits «+9627…» as 962 and «+14155…» as 1. An unknown code falls
 * back to a single digit — the number still renders, just grouped differently.
 * Validity is NEVER decided here (see lib/format/phone-validate.ts).
 */
const KNOWN_CALLING_CODES = new Set([
  '962',
  '966',
  '971',
  '973',
  '974',
  '965',
  '968',
  '970',
  '972',
  '961',
  '963',
  '964',
  '967',
  '20',
  '90',
  '44',
  '49',
  '33',
  '39',
  '31',
  '46',
  '47',
  '41',
  '61',
  '81',
  '86',
  '91',
  '7',
  '1',
]);
const CALLING_CODE_LENGTHS = [3, 2, 1];

/**
 * The suffix a phone search matches on (§2.3.4). The last 8 digits are the
 * part a human remembers and types, and they are identical across every
 * accepted input shape (07…, +9627…, ٠٧…), so a search finds the patient
 * whichever way the number is written.
 */
export function phoneSearchSuffix(input: string): string | null {
  const digits = foldEasternDigits(input).replace(/\D+/g, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
}
