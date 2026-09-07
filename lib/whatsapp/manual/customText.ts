/**
 * P60 §4.3 — the custom-message text goes out as a WhatsApp template
 * PARAMETER, and WhatsApp rejects parameters that contain newlines, tabs,
 * or four+ consecutive spaces (the whole template body is also capped at
 * 1024 characters; the frame leaves ~800 for the text). Pure normalizer +
 * validator, shared by the Zod schema and the panel's live preview so what
 * the secretary sees is what the parameter will be.
 */
export const CUSTOM_TEXT_MAX = 800;

// Line/paragraph separators (incl. U+2028/U+2029) + tabs + the non-breaking
// space → one space.
const BREAKS = /[\r\n\t\u2028\u2029\u00a0]+/g;
// WhatsApp rejects 4+ consecutive spaces inside a parameter.
const SPACE_RUNS = / {4,}/g;

export function normalizeCustomText(raw: string): string {
  return raw.replace(BREAKS, ' ').replace(SPACE_RUNS, ' ').trim();
}

export type CustomTextValidation =
  | { ok: true; text: string }
  | { ok: false; reason: 'EMPTY' | 'TOO_LONG' };

export function validateCustomText(raw: string): CustomTextValidation {
  const text = normalizeCustomText(raw);
  if (text.length === 0) return { ok: false, reason: 'EMPTY' };
  if (text.length > CUSTOM_TEXT_MAX) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, text };
}
