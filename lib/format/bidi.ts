/**
 * Bidi isolation for runtime values interpolated into translated strings
 * (QA 6.5).
 *
 * Mixing an RTL label with an LTR value (e.g. the Arabic byline
 * «لـ Abdullah Soubani · بواسطة …») lets the Unicode Bidi Algorithm resolve
 * the neutral separators («·», spaces, digits) against the surrounding
 * paragraph, visually reordering the segments. Wrapping the value in
 * FSI (U+2068) … PDI (U+2069) — First-Strong Isolate — makes it an isolated
 * run whose direction comes from its own first strong character, exactly
 * like the HTML `<bdi>` element.
 *
 * Use for values that live INSIDE a translated ICU message or a plain string
 * prop where JSX `<bdi>` isn't available (names, phone numbers, free text).
 * Render-time only: never persist or compare isolated strings.
 */
export function bidiIsolate(value: string): string {
  if (!value) return value;
  return `\u2068${value}\u2069`;
}
