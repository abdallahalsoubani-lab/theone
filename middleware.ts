import { NextResponse, type NextRequest } from 'next/server';

const SUPPORTED_LOCALES = ['en', 'ar'] as const;
const DEFAULT_LOCALE = 'en';

/**
 * Minimal locale-prefix middleware for Phase 0.
 *
 * Redirects bare paths like `/` and `/style-guide` to `/{default-locale}/...`.
 * Prompt 3 replaces this with the full next-intl middleware (Accept-Language
 * negotiation, locale persistence, etc.).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split('/')[1];

  if (firstSegment && (SUPPORTED_LOCALES as readonly string[]).includes(firstSegment)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|api|favicon\\.ico|logo.*\\.svg|.*\\.png|.*\\.jpg).*)'],
};
