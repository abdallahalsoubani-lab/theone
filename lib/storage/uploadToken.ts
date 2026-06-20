import { SignJWT, jwtVerify } from 'jose';

import { env } from '@/lib/env';

/**
 * Short-lived signed capability for a single direct upload (Calendar/Exercise
 * Fix Prompt 4 — proxy-upload path).
 *
 * Replaces the S3 presigned-PUT signature: on this single-VM topology MinIO is
 * localhost-only and not browser-reachable, so uploads stream through a
 * same-origin Next route instead. This token is what authorizes that route —
 * the capability model is identical to a presigned URL (possession = grant),
 * just signed with our own key (AUTH_SECRET) and scoped to one object key +
 * content-type + size ceiling. Issued only by code that has already run the
 * `can()` permission check (createUploadUrl / createPendingDocument).
 */
export interface UploadClaims {
  key: string;
  contentType: string;
  maxBytes: number;
}

const ISSUER = 'theone.pt/upload';
const AUDIENCE = 'theone.pt';
export const UPLOAD_TTL_SECONDS = 15 * 60;

function getSecret(): Uint8Array {
  const secret = env.AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error('[upload] AUTH_SECRET is required to sign upload tokens.');
  return new TextEncoder().encode(secret);
}

export async function signUploadToken(claims: UploadClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    key: claims.key,
    contentType: claims.contentType,
    maxBytes: claims.maxBytes,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + UPLOAD_TTL_SECONDS)
    .sign(getSecret());
}

/** Returns the claims, or null on any failure (bad sig, expired, tampered). */
export async function verifyUploadToken(token: string): Promise<UploadClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      typeof payload.key !== 'string' ||
      typeof payload.contentType !== 'string' ||
      typeof payload.maxBytes !== 'number'
    ) {
      return null;
    }
    return { key: payload.key, contentType: payload.contentType, maxBytes: payload.maxBytes };
  } catch {
    return null;
  }
}
