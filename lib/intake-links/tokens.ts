import { randomBytes } from 'node:crypto';

/**
 * P52 — personal intake-link token. A long, URL-safe, cryptographically
 * random secret (32 bytes → 43 base64url chars). Treated as a bearer
 * secret: single-use, never logged in full, never exposed in list
 * endpoints. Mirrors the arrivals `generateAccessToken` design but its own
 * copy so the two surfaces evolve independently.
 */
export function generateIntakeToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Redacted form for logs — first 6 chars then a marker, never the secret. */
export function redactToken(token: string): string {
  return `${token.slice(0, 6)}…`;
}
