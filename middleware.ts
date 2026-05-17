import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/auth.edge';
import { routing } from '@/i18n/routing';
import {
  PASSWORD_GATE_ALLOWLIST,
  ROLE_HOME,
  isPasswordGateAllowed,
  isPublicPath,
} from '@/lib/auth/routes';

const intlMiddleware = createIntlMiddleware(routing);

const LOCALES = routing.locales;

interface LocaleMatch {
  locale: (typeof LOCALES)[number];
  barePath: string;
}

function splitLocale(pathname: string): LocaleMatch | null {
  const segs = pathname.split('/');
  const locale = segs[1] as (typeof LOCALES)[number] | undefined;
  if (!locale || !(LOCALES as readonly string[]).includes(locale)) return null;
  const rest = segs.slice(2).join('/');
  return { locale, barePath: rest ? `/${rest}` : '/' };
}

/**
 * Combined middleware (Prompt 4 §4.11).
 *
 *   1. Run next-intl first so we know the resolved locale.
 *      If intl returns a redirect (locale missing → /<default>/...), honour it.
 *   2. Read the Auth.js session via auth().
 *   3. Apply auth rules:
 *        - public path  → pass through
 *        - no session   → redirect to /<locale>/login?from=<bare>
 *        - mustChange   → redirect to /<locale>/change-password (everywhere
 *                         except the allowlist)
 *        - already auth → /login bounces to /<locale>/<roleHome>
 */
export default auth(async (req) => {
  const intlResponse = intlMiddleware(req as unknown as NextRequest);

  // If next-intl wants to redirect (locale-prefix), let it run.
  const intlLocation = intlResponse.headers.get('location');
  if (intlLocation && intlResponse.status >= 300 && intlResponse.status < 400) {
    return intlResponse;
  }

  const match = splitLocale(req.nextUrl.pathname);
  if (!match) return intlResponse;
  const { locale, barePath } = match;

  const session = req.auth;

  const onPublic = isPublicPath(barePath);

  if (!session?.user) {
    if (onPublic) return intlResponse;
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.searchParams.set('from', barePath);
    return NextResponse.redirect(url);
  }

  // Authenticated visitor on /login or other auth-only public path → role home.
  const authOnly = onPublic && (barePath === '/login' || barePath === '/forgot-password');
  if (authOnly && !session.user.mustChangePassword) {
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}${ROLE_HOME[session.user.role]}`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Forced password change. /change-password and signout are exempt.
  if (session.user.mustChangePassword && !isPasswordGateAllowed(barePath)) {
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}/change-password`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return intlResponse;
});

export const config = {
  // Excludes /api, /_next, static files, and the auth callback (we never want
  // to redirect Auth.js's own route handlers).
  matcher: ['/((?!api/auth|api|_next|_vercel|.*\\..*).*)'],
};

// Silences unused-import warnings — the import documents the gate's allowlist.
void PASSWORD_GATE_ALLOWLIST;
