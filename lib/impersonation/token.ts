import { SignJWT, jwtVerify } from 'jose';

import { env } from '@/lib/env';

/**
 * Signed JWT carrying the impersonation context for the duration of an
 * Admin impersonation session. Stored in an HttpOnly cookie — never
 * accessible from JavaScript, never persisted in the database.
 *
 * The cookie is the *single* source of truth for impersonation. Server
 * restarts therefore wipe every active session, which is the desired
 * behaviour: an impersonation is a deliberate, foreground action by an
 * Admin and should never silently survive an outage.
 *
 * Signed with the same secret Auth.js uses for the session JWT
 * (`AUTH_SECRET`) so we don't introduce a second key to manage.
 */
export interface ImpersonationClaims {
  /** The real Admin's user id — never replaced by the target id. */
  adminId: string;
  /** The id of the user being impersonated. */
  targetUserId: string;
  /** The target user's role, captured at the start to avoid a second DB lookup
   *  before middleware/RBAC can run. Re-verified server-side on every protected
   *  read so a role change mid-session is still respected. */
  targetRole: 'PATIENT' | 'SECRETARY' | 'DOCTOR' | 'THERAPIST' | 'ADMIN';
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expires-at, seconds since epoch. Hard-capped at 4 hours from `iat`. */
  exp: number;
}

const ISSUER = 'theone.pt/impersonation';
const AUDIENCE = 'theone.pt';
export const IMPERSONATION_TTL_SECONDS = 60 * 60 * 4; // 4 hours

/**
 * Cookie name. Lives in this Edge-safe module (no `next/headers`, no DB
 * client) so the middleware can import it without dragging the
 * `server-only` cookie/session modules into the Edge bundle.
 */
export const IMPERSONATION_COOKIE = 'theone_impersonation';

function getSecret(): Uint8Array {
  const secret = env.AUTH_SECRET;
  if (!secret) {
    throw new Error('[impersonation] AUTH_SECRET is required to sign impersonation tokens.');
  }
  return new TextEncoder().encode(secret);
}

export async function signImpersonationToken(
  claims: Omit<ImpersonationClaims, 'iat' | 'exp'>,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + IMPERSONATION_TTL_SECONDS;
  return new SignJWT({
    adminId: claims.adminId,
    targetUserId: claims.targetUserId,
    targetRole: claims.targetRole,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecret());
}

/**
 * Verifies the signed token and returns the claims, or null when verification
 * fails for any reason (expired, bad signature, tampered, missing secret).
 * Callers must always treat null as "not impersonating" — never as an error
 * worth surfacing, since the cookie is a soft signal not a security boundary.
 */
export async function verifyImpersonationToken(token: string): Promise<ImpersonationClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const adminId = payload.adminId;
    const targetUserId = payload.targetUserId;
    const targetRole = payload.targetRole;
    if (
      typeof adminId !== 'string' ||
      typeof targetUserId !== 'string' ||
      typeof targetRole !== 'string'
    ) {
      return null;
    }
    return {
      adminId,
      targetUserId,
      targetRole: targetRole as ImpersonationClaims['targetRole'],
      iat: typeof payload.iat === 'number' ? payload.iat : 0,
      exp: typeof payload.exp === 'number' ? payload.exp : 0,
    };
  } catch {
    return null;
  }
}
