import 'server-only';

import { cookies } from 'next/headers';

import { env } from '@/lib/env';

import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_SECONDS,
  type ImpersonationClaims,
  signImpersonationToken,
  verifyImpersonationToken,
} from './token';

export { IMPERSONATION_COOKIE };

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
  // `cookies()` throws outside a request scope (background workers, vitest
  // suites that exercise audited services directly). Treat any such failure
  // as "no impersonation" rather than propagating — impersonation must
  // never break code paths that don't know about it.
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return null;
  }
  const token = store.get(IMPERSONATION_COOKIE)?.value;
  if (!token) return null;
  return verifyImpersonationToken(token);
}
