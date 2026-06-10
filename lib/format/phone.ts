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

export function formatPhone(input: string): string {
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
