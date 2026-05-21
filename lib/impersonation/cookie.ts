import 'server-only';

import { cookies } from 'next/headers';

import { env } from '@/lib/env';

import {
  IMPERSONATION_TTL_SECONDS,
  type ImpersonationClaims,
  signImpersonationToken,
  verifyImpersonationToken,
} from './token';

/**
 * Cookie name. Prefixed with `theone_` to keep it grouped with the rest of
 * the app's cookies when an admin opens DevTools. Not `__Host-` prefixed
 * because dev runs over plain HTTP — production sets `Secure` via the
 * cookie attributes below.
 */
export const IMPERSONATION_COOKIE = 'theone_impersonation';

/**
 * Issue a fresh signed token and set it as an HttpOnly cookie. The TTL
 * mirrors the JWT `exp` claim so the browser drops the cookie at the same
 * moment the server stops accepting it.
 */
export async function setImpersonationCookie(
  claims: Omit<ImpersonationClaims, 'iat' | 'exp'>,
): Promise<void> {
  const token = await signImpersonationToken(claims);
  const store = await cookies();
  store.set(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: IMPERSONATION_TTL_SECONDS,
  });
}

/** Removes the impersonation cookie. Idempotent — safe to call without checking. */
export async function clearImpersonationCookie(): Promise<void> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
}

/**
 * Reads the cookie, verifies the signature, returns the claims or null.
 * Tamper, expiry, missing cookie — all collapse to null. This is the only
 * function the rest of the codebase imports to learn whether an
 * impersonation session is active.
 */
export async function readImpersonationCookie(): Promise<ImpersonationClaims | null> {
  const store = await cookies();
  const token = store.get(IMPERSONATION_COOKIE)?.value;
  if (!token) return null;
  return verifyImpersonationToken(token);
}
