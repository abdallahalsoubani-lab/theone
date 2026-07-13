import path from 'node:path';

import { Font } from '@react-pdf/renderer';

/**
 * PDF font registration (Prompt 22 QA §2.4).
 *
 * The PDF standard-14 'Helvetica' has zero Arabic glyphs — pdfkit silently
 * truncates each Arabic codepoint to its low byte, so every Arabic string
 * rendered mojibake. Fix: embed the brand font, IBM Plex Sans Arabic
 * (SIL OFL, vendored under public/fonts/pdf/ — no runtime network fetch;
 * matches the web app's next/font family in app/[locale]/layout.tsx and
 * the Technical Spec §typography).
 *
 * One family serves both locales: IBM Plex Sans Arabic ships full Latin
 * coverage alongside Arabic (verified by the smoke tests in
 * __tests__/pdf-arabic.test.ts), and @react-pdf/renderer cannot reliably
 * fall back across families mid-run, so a single Arabic-capable family is
 * the safe choice. Both weights the stylesheets use (400 + 700) are
 * registered — react-pdf otherwise silently substitutes the nearest
 * registered weight and headings lose their bold.
 *
 * `process.cwd()` resolves to the repo root both under `next start` on the
 * production VM (pm2 runs from the repo root) and under Vitest.
 */

const FONT_DIR = path.join(process.cwd(), 'public', 'fonts', 'pdf');

/** The single font family every PDF stylesheet uses (Latin + Arabic). */
export const PDF_FONT_FAMILY = 'IBMPlexSansArabic';

Font.register({
  family: PDF_FONT_FAMILY,
  fonts: [
    { src: path.join(FONT_DIR, 'IBMPlexSansArabic-Regular.ttf'), fontWeight: 400 },
    { src: path.join(FONT_DIR, 'IBMPlexSansArabic-Bold.ttf'), fontWeight: 700 },
  ],
});

// Disable hyphenation globally. react-pdf's default hyphenator breaks
// Arabic words mid-glyph-cluster (Arabic is never hyphenated); returning
// the word whole is the documented fix, and losing hyphenation for Latin
// text is harmless at these font sizes.
Font.registerHyphenationCallback((word) => [word]);

/**
 * Purge the fontkit glyph caches of every registered PDF font.
 *
 * Workaround for a glyph-cache poisoning bug in the pinned renderer stack
 * (@react-pdf/renderer 4.5.1 → pdfkit fork + fontkit 2.0.4), reproduced and
 * verified against this repo's node_modules: when a document is embedded,
 * pdfkit's TrueType subsetter walks composite glyphs and calls
 * `font.getGlyph(componentId)` WITHOUT code points (e.g. the ح base glyph
 * referenced inside the ج composite). fontkit caches that empty-codePoints
 * Glyph on the shared font instance keyed by id alone — so the NEXT document
 * whose Arabic text shapes to that glyph gets the poisoned object, textkit's
 * stringIndices come up short, and the render crashes inside bidi reordering
 * with "Cannot read properties of undefined (reading 'id')".
 *
 * Clearing the private `_glyphs` cache before each render restores fresh
 * glyph resolution (layout re-creates glyphs with correct code points) at
 * negligible cost. `Font.reset()` is NOT usable instead — in
 * @react-pdf/font 4.0.8 it nulls `data` without clearing
 * `loadResultPromise`, so the font never reloads and the next render throws.
 * The cross-render regression tests in __tests__/pdf-arabic.test.ts render
 * several documents in one process and fail if this workaround regresses.
 */
export function purgePdfFontGlyphCache(): void {
  const families = Font.getRegisteredFonts();
  for (const family of Object.values(families)) {
    for (const source of family.sources) {
      const data = source.data as { _glyphs?: Record<number, unknown> } | null;
      if (data?._glyphs) data._glyphs = {};
    }
  }
}

/**
 * Direction styles for RTL documents.
 *
 * react-pdf's `direction` style is consumed per <Text> and is NOT in the
 * renderer's inheritable-property set (unlike `fontFamily`), so it cannot
 * be set once at the <Page> level — every text node in an Arabic document
 * needs it. With `direction: 'rtl'` the bundled UAX#9 bidi engine gives
 * mixed Arabic/Latin/digit lines an RTL base direction and orders the
 * segments correctly.
 *
 *   text   — body/label text: RTL base direction + right alignment.
 *   center — centered text (footers): RTL base direction, keep centering.
 *   row    — label/value and table rows: flip the horizontal order.
 */
export function pdfDir(ar: boolean) {
  if (!ar) return { text: {}, center: {}, row: {} } as const;
  return {
    text: { direction: 'rtl', textAlign: 'right' },
    center: { direction: 'rtl' },
    row: { flexDirection: 'row-reverse' },
  } as const;
}
