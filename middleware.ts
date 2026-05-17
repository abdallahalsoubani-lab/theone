import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

/**
 * next-intl handles the full detection chain:
 *   1. URL segment (/en/... or /ar/...) — wins if present
 *   2. NEXT_LOCALE cookie — set by the language toggle
 *   3. Accept-Language header — for fresh visitors
 *   4. routing.defaultLocale (ar)
 *
 * Always-prefixed strategy means visiting `/` issues a 307 to `/<resolved>`,
 * which is exactly what Prompt 3 §4.1 specifies.
 */
export default createMiddleware(routing);

export const config = {
  // Match every path except API routes, Next internals, static assets, and
  // requests for files with extensions (e.g. /logo.svg). Image and font
  // responses must skip the locale prefix or next/font collapses at runtime.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
