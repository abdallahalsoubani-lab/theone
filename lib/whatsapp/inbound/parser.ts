import type { WaInboundIntent } from '@prisma/client';

/**
 * Inbound intent classification.
 *
 * Patients reply to our reminders / confirmations in either English or
 * Arabic. The parser matches the first non-whitespace token (lowercased
 * + diacritic-stripped) against the dictionaries below and returns one
 * of: CONFIRM, RESCHEDULE_REQUEST, CANCEL_REQUEST, UNKNOWN.
 *
 * Two tolerances we explicitly handle:
 *   - Arabic diacritics ("نَعَم" → "نعم") via a precomputed strip
 *   - Common Arabic typos ("نعمم" → "نعم"; "اوكي" / "اوك" both confirm)
 *     captured by listing the variants directly in the dictionary
 *
 * UNKNOWN is the safe fallback — the inbound handler surfaces those in
 * the Secretary inbox without auto-action, so misclassifications fail
 * closed rather than triggering a wrong appointment update.
 */

const ARABIC_DIACRITICS = /[ً-ٰٟ]/g;
const TATWEEL = /ـ/g;

/**
 * Normalize an inbound body to a comparison form: trim, lowercase
 * (Latin), strip Arabic diacritics + tatweel, normalize various Arabic
 * alif variants and yaa/ya-maksoura to a single canonical form.
 */
export function normalizeInbound(body: string): string {
  if (!body) return '';
  const trimmed = body.trim();
  if (!trimmed) return '';
  return trimmed
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

function firstToken(normalized: string): string {
  // Split on whitespace and common separators (period, exclamation,
  // question). Keep dashes / underscores intact (they sometimes form
  // single-word replies like "no-show").
  const match = normalized.match(/^[^\s.!?،,]+/);
  return match ? match[0] : normalized;
}

const CONFIRM_TOKENS: ReadonlySet<string> = new Set([
  // English / numeric
  '1',
  'yes',
  'y',
  'confirm',
  'confirmed',
  'ok',
  'okay',
  'sure',
  // Arabic (with normalization applied)
  'نعم',
  'نعمم', // common typo
  'موافق',
  'تاكيد', // "تأكيد" → ة/ه not applied here; normalization preserves
  'تأكيد',
  'اوكي',
  'اوك',
  'اي',
  'تمام',
]);

const RESCHEDULE_TOKENS: ReadonlySet<string> = new Set([
  // English / numeric
  '2',
  'change',
  'reschedule',
  'rescheduled',
  'reschedul',
  // Arabic
  'غير',
  'تغيير',
  'تاجيل',
  'تأجيل',
  'تأجل',
  'تاجل',
  'موعد',
]);

const CANCEL_TOKENS: ReadonlySet<string> = new Set([
  // English
  '3',
  'cancel',
  'cancelled',
  'stop',
  'no',
  // Arabic
  'الغاء',
  'إلغاء',
  'وقف',
  'لا',
]);

/** Quick-reply button ids registered on the v2 reminder template (48b §1.1). */
export const BUTTON_CONFIRM_ID = 'confirm';
export const BUTTON_DECLINE_ID = 'decline';

/**
 * Intent with quick-reply awareness (Prompt 48b): a button tap's developer
 * id is authoritative — no text guessing. Unknown payloads and plain
 * messages fall through to the conservative text parser (button TEXT is
 * parsed too so localized labels like "تأكيد الحضور" work even if a
 * provider drops the payload field).
 */
export function parseIntentWithButtons(args: {
  body: string;
  buttonPayload?: string;
  buttonText?: string;
}): WaInboundIntent {
  const payload = args.buttonPayload?.trim().toLowerCase();
  if (payload === BUTTON_CONFIRM_ID) return 'CONFIRM';
  if (payload === BUTTON_DECLINE_ID) return 'CANCEL_REQUEST';
  const text = args.body || args.buttonText || '';
  // The v2 button labels themselves ("تأكيد الحضور" / "عدم التأكيد").
  const normalized = normalizeInbound(text);
  if (normalized === 'تاكيد الحضور' || normalized === 'confirm attendance') return 'CONFIRM';
  if (
    normalized === 'عدم التاكيد' ||
    normalized === "can't confirm" ||
    normalized === 'cant confirm'
  )
    return 'CANCEL_REQUEST';
  return parseIntent(text);
}

export function parseIntent(body: string): WaInboundIntent {
  const normalized = normalizeInbound(body);
  if (!normalized) return 'UNKNOWN';
  const token = firstToken(normalized);

  if (CONFIRM_TOKENS.has(token)) return 'CONFIRM';
  if (RESCHEDULE_TOKENS.has(token)) return 'RESCHEDULE_REQUEST';
  if (CANCEL_TOKENS.has(token)) return 'CANCEL_REQUEST';

  // Multi-token Arabic phrases we want to catch even when not the first
  // token (e.g., "موعد ثاني" = "another appointment" → reschedule).
  if (normalized.includes('موعد ثاني') || normalized.includes('موعد جديد')) {
    return 'RESCHEDULE_REQUEST';
  }
  if (normalized.includes('بدي اغير') || normalized.includes('بدي تغيير')) {
    return 'RESCHEDULE_REQUEST';
  }

  return 'UNKNOWN';
}
