import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { foldEasternDigits, normalizePhoneForStorage } from './phone';

/**
 * P61 item 2 — STRICT phone validation. Server-side only, on purpose.
 *
 * `libphonenumber-js` carries ~150 kB of country metadata. The patient forms
 * share their Zod schema with the browser (react-hook-form resolver), so
 * importing this module from a schema would ship that metadata to every
 * client bundle — and the first-load budget has ~20 kB of headroom. The split
 * is therefore:
 *
 *   lib/format/phone.ts          cheap, dependency-free, client-safe: decides
 *                                the canonical STORAGE shape (+E.164) and
 *                                catches the obvious garbage inline in the form
 *   lib/format/phone-validate.ts (this file) the authority on whether a number
 *                                is actually valid FOR ITS COUNTRY — called by
 *                                the services/actions before anything is stored
 *
 * Canonical storage format is unchanged (E.164 with a leading `+`), so there
 * is no migration and the Twilio path (`whatsapp:${phone}`) is untouched.
 */

/** Jordan stays the implicit country: a bare `07…` keeps working untouched. */
export const DEFAULT_PHONE_COUNTRY = 'JO' as const;

export interface PhoneParseResult {
  ok: boolean;
  /** Canonical E.164 (`+9627…`, `+1415…`) — only set when ok. */
  e164: string | null;
  /** ISO country the number resolved to, when known. */
  country: string | null;
}

/**
 * Parse + validate a human-entered phone number.
 *
 * - a bare local number (`07…`, `٠٧…`) is read as Jordanian (decision 1);
 * - anything with an explicit country code is accepted **iff it is a valid
 *   number for that country** — not merely "enough digits" (decision 2), so
 *   `+1 (415) 555-2671` passes while `+1 415 555` and `+999…` do not.
 */
export function parsePhone(
  input: string,
  defaultCountry = DEFAULT_PHONE_COUNTRY,
): PhoneParseResult {
  const raw = foldEasternDigits(input ?? '').trim();
  if (!raw) return { ok: false, e164: null, country: null };

  // `00…` is the international prefix people dial; the parser wants `+`.
  const forParser = raw.startsWith('00') ? `+${raw.slice(2)}` : raw;
  const parsed = parsePhoneNumberFromString(forParser, defaultCountry);
  if (parsed?.isValid()) {
    return { ok: true, e164: parsed.number, country: parsed.country ?? null };
  }
  return { ok: false, e164: null, country: null };
}

/** True when the input is a valid number (anywhere). */
export function isValidPhone(input: string, defaultCountry = DEFAULT_PHONE_COUNTRY): boolean {
  return parsePhone(input, defaultCountry).ok;
}

/**
 * THE storage normaliser for server paths: strict validity first, with the
 * cheap canonicaliser as the fallback shape for numbers the metadata cannot
 * classify but that are structurally sound. Returns null when the number must
 * be rejected.
 */
export function normalizePhoneStrict(
  input: string,
  defaultCountry = DEFAULT_PHONE_COUNTRY,
): string | null {
  const parsed = parsePhone(input, defaultCountry);
  if (parsed.ok) return parsed.e164;
  // Not valid for any country → rejected. (The cheap normaliser is reused only
  // to keep the canonical SHAPE identical, never to widen what is accepted.)
  return null;
}

/** The canonical form of an already-stored value, for comparisons. */
export function canonicalStoredPhone(stored: string): string | null {
  return normalizePhoneStrict(stored) ?? normalizePhoneForStorage(stored);
}
