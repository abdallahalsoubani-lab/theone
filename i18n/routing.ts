import { defineRouting } from 'next-intl/routing';

/**
 * Locale routing config — single source of truth for the next-intl middleware,
 * the request handler, the language toggle, and any future locale-aware code.
 *
 * Choices locked by Prompt 3 §4.1:
 *   - Locales:        en, ar
 *   - Default locale: ar — clinic is in Jordan, primary user base is Arabic
 *   - URL strategy:   always-prefixed (/en/... or /ar/..., never bare /...)
 *   - Cookie name:    NEXT_LOCALE (next-intl's default; matches the prompt)
 */
export const routing = defineRouting({
  locales: ['en', 'ar'],
  defaultLocale: 'ar',
  localePrefix: 'always',
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
