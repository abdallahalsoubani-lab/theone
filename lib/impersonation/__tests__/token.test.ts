import { beforeAll, describe, expect, it } from 'vitest';

import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_SECONDS,
  signImpersonationToken,
  verifyImpersonationToken,
} from '../token';

beforeAll(() => {
  // Mirror `.env.test`-style minimum so the token module can read AUTH_SECRET.
  // 32+ chars satisfies the env schema and HMAC256.
  process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret-1234';
});

const baseClaims = {
  adminId: 'admin-1',
  targetUserId: 'user-2',
  targetRole: 'THERAPIST' as const,
};

describe('impersonation token', () => {
  it('exposes the cookie name expected by middleware and the cookie helper', () => {
    expect(IMPERSONATION_COOKIE).toBe('theone_impersonation');
  });

  it('TTL is 4 hours', () => {
    expect(IMPERSONATION_TTL_SECONDS).toBe(60 * 60 * 4);
  });

  it('signs and verifies a round-trip', async () => {
    const token = await signImpersonationToken(baseClaims);
    const claims = await verifyImpersonationToken(token);
    expect(claims).not.toBeNull();
    expect(claims).toMatchObject(baseClaims);
    // exp = iat + TTL, both populated
    expect(claims!.exp - claims!.iat).toBe(IMPERSONATION_TTL_SECONDS);
  });

  it('returns null for a tampered token', async () => {
    const token = await signImpersonationToken(baseClaims);
    // Flip a byte in the payload section so the signature no longer matches.
    const parts = token.split('.');
    const tampered = [parts[0], parts[1]!.slice(0, -2) + 'AA', parts[2]].join('.');
    const claims = await verifyImpersonationToken(tampered);
    expect(claims).toBeNull();
  });

  it('returns null for a token signed with a different secret', async () => {
    const token = await signImpersonationToken(baseClaims);
    process.env.AUTH_SECRET = 'a-completely-different-secret-32+chars';
    try {
      const claims = await verifyImpersonationToken(token);
      expect(claims).toBeNull();
    } finally {
      process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret-1234';
    }
  });

  it('returns null for a non-JWT string', async () => {
    expect(await verifyImpersonationToken('not.a.jwt')).toBeNull();
    expect(await verifyImpersonationToken('')).toBeNull();
  });

  it('preserves the targetRole verbatim across sign + verify', async () => {
    for (const role of ['PATIENT', 'SECRETARY', 'DOCTOR', 'THERAPIST'] as const) {
      const token = await signImpersonationToken({ ...baseClaims, targetRole: role });
      const claims = await verifyImpersonationToken(token);
      expect(claims?.targetRole).toBe(role);
    }
  });
});
