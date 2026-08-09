/**
 * Text folding for COMPARISON — never for storage or display.
 *
 * The rules mirror the WhatsApp inbound parser's `normalizeInbound`, which has
 * folded Arabic this way since Prompt 48b. Exercise names need the same fold:
 * "تمرين الإطالة" and "تمرين الاطالة" are the same exercise to a human typing
 * it, and a duplicate guard that only lowercases Latin letters lets the second
 * one through.
 *
 * The parser deliberately keeps its own copy rather than importing this: its
 * keyword dictionary is written PRE-FOLDED to match those exact rules, so
 * sharing the function would make any future tweak here silently change reply
 * classification. Two callers, two intents — the duplication is the guard.
 */

const ARABIC_DIACRITICS = /[ً-ٰٟ]/g;
const TATWEEL = /ـ/g;

/**
 * Canonical comparison form: trimmed, Latin lowercased, Arabic diacritics and
 * tatweel stripped, alif/yaa/taa-marbuta variants folded to one spelling.
 */
export function normalizeText(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/**
 * `normalizeText` plus internal-whitespace collapsing — the form to compare
 * NAMES with, so "Wall  pushup" and "Wall pushup" are one name.
 *
 * Kept separate from `normalizeText` because the parser must NOT collapse
 * whitespace: it splits the folded body on spaces to read the first token.
 */
export function normalizeName(value: string): string {
  return normalizeText(value).replace(/\s+/g, ' ');
}
