import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/auth.edge';
import { routing } from '@/i18n/routing';
import {
  PASSWORD_GATE_ALLOWLIST,
  ROLE_HOME,
  isPasswordGateAllowed,
  isPathAllowedForRole,
  isPublicPath,
} from '@/lib/auth/routes';
// Direct import from the Edge-safe token module — the barrel re-exports
// server-only helpers (cookie.ts uses next/headers, session.ts uses the
// Prisma client) that would break the Edge bundle.
import { IMPERSONATION_COOKIE, verifyImpersonationToken } from '@/lib/impersonation/token';

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

  // Authenticated visitor on the public landing or an auth-only page → role
  // home. Logged-out visitors keep seeing the marketing landing at `/`.
  const authOnly =
    onPublic && (barePath === '/' || barePath === '/login' || barePath === '/forgot-password');
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

  // ── Role-prefix gate ────────────────────────────────────────────────
  //
  // Each top-level role segment (/admin, /secretary, /doctor, /therapist,
  // /patient) belongs to that role's UI. A clinician clicking a stale
  // link into a sibling role's surface should silently land on their own
  // dashboard — not a ForbiddenError page. `requirePermission` at the
  // page boundary is still the authoritative gate; this is the pre-render
  // UX redirect that prevents the error class entirely. Admin is allowed
  // everywhere (see `lib/auth/routes.ts → ROLE_PATH_PREFIXES`).
  if (!isPathAllowedForRole(barePath, session.user.role)) {
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}${ROLE_HOME[session.user.role]}`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  // ── Impersonation guard ─────────────────────────────────────────────
  //
  // The cookie is the single source of truth for impersonation. Verify it
  // with jose (Edge-safe) on every protected request so:
  //   - a tampered cookie can never reach a route handler,
  //   - if the real session is no longer Admin (logout + login as a
  //     different role with the cookie still around) we wipe the cookie,
  //   - while impersonation is active, navigating to /admin/* bounces
  //     to the impersonated user's role home — the Admin must explicitly
  //     "Exit impersonation" to come back to the admin area.
  const impersonationToken = req.cookies.get(IMPERSONATION_COOKIE)?.value;
  if (impersonationToken) {
    const claims = await verifyImpersonationToken(impersonationToken);
    const validForThisSession =
      !!claims && session.user.role === 'ADMIN' && claims.adminId === session.user.id;

    if (!validForThisSession) {
      // Tampered cookie OR real session is not the admin that issued the
      // token (logged out, logged in as someone else, role downgraded…).
      // Clear it and continue with the request — RBAC will treat the
      // user as the real session below.
      const cleared = NextResponse.next();
      cleared.cookies.delete(IMPERSONATION_COOKIE);
      return cleared;
    }

    // Active impersonation → /admin/* is off-limits until the Admin exits.
    // The role-home for the *impersonated* user is the destination so the
    // Admin can immediately continue testing as that user.
    if (barePath.startsWith('/admin')) {
      const url = req.nextUrl.clone();
      url.pathname = `/${locale}${ROLE_HOME[claims.targetRole]}`;
      url.search = '';
      return NextResponse.redirect(url);
    }
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
