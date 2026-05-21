import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImpersonationClaims } from '../token';

// ──────────────────────────────────────────────────────────────────────
// Mocks. Hoisted so the imports below can resolve against the mocked
// implementations rather than reaching for real cookies / DB / auth.
// ──────────────────────────────────────────────────────────────────────
const authMock = vi.fn();
vi.mock('@/auth', () => ({
  auth: () => authMock(),
}));

const findUniqueMock = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
  },
}));

const readCookieMock = vi.fn();
vi.mock('../cookie', () => ({
  readImpersonationCookie: () => readCookieMock(),
}));

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret-1234';
});

// Import after mocks are registered.
const { getEffectiveSession } = await import('../session');

const adminUser = {
  id: 'admin-1',
  role: 'ADMIN' as const,
  languagePref: 'EN' as const,
  fullNameEn: 'Admin User',
  fullNameAr: 'مسؤول',
  mustChangePassword: false,
  email: 'admin@theone.pt',
};

const therapistUser = {
  id: 'user-2',
  role: 'THERAPIST' as const,
  languagePref: 'EN' as const,
  fullNameEn: 'Layan',
  fullNameAr: 'ليان',
  mustChangePassword: false,
  email: 'layan@theone.pt',
};

const impersonationClaims: ImpersonationClaims = {
  adminId: adminUser.id,
  targetUserId: therapistUser.id,
  targetRole: therapistUser.role,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeEach(() => {
  authMock.mockReset();
  findUniqueMock.mockReset();
  readCookieMock.mockReset();
});

describe('getEffectiveSession', () => {
  it('returns null when no Auth.js session', async () => {
    authMock.mockResolvedValueOnce(null);
    expect(await getEffectiveSession()).toBeNull();
  });

  it('returns the real session unchanged when no impersonation cookie', async () => {
    authMock.mockResolvedValueOnce({ user: adminUser });
    readCookieMock.mockResolvedValueOnce(null);
    const s = await getEffectiveSession();
    expect(s?.isImpersonating).toBe(false);
    expect(s?.user.id).toBe(adminUser.id);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('swaps user to the impersonated target when cookie is valid and caller is Admin', async () => {
    authMock.mockResolvedValueOnce({ user: adminUser });
    readCookieMock.mockResolvedValueOnce(impersonationClaims);
    findUniqueMock.mockResolvedValueOnce(therapistUser);
    const s = await getEffectiveSession();
    expect(s).not.toBeNull();
    expect(s!.isImpersonating).toBe(true);
    expect(s!.user.id).toBe(therapistUser.id);
    expect(s!.user.role).toBe('THERAPIST');
    if (s && s.isImpersonating) {
      expect(s.adminId).toBe(adminUser.id);
      expect(s.realAdmin.id).toBe(adminUser.id);
    }
  });

  it('ignores cookie when real session is not Admin (RBAC privilege escalation guard)', async () => {
    authMock.mockResolvedValueOnce({
      user: { ...therapistUser, role: 'SECRETARY' as const },
    });
    readCookieMock.mockResolvedValueOnce(impersonationClaims);
    const s = await getEffectiveSession();
    expect(s?.isImpersonating).toBe(false);
    expect(s?.user.role).toBe('SECRETARY');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('ignores cookie when adminId does not match the real session (stolen cookie)', async () => {
    authMock.mockResolvedValueOnce({
      user: { ...adminUser, id: 'different-admin' },
    });
    readCookieMock.mockResolvedValueOnce(impersonationClaims);
    const s = await getEffectiveSession();
    expect(s?.isImpersonating).toBe(false);
    expect(s?.user.id).toBe('different-admin');
  });

  it('falls back to real session when the impersonated user was deleted', async () => {
    authMock.mockResolvedValueOnce({ user: adminUser });
    readCookieMock.mockResolvedValueOnce(impersonationClaims);
    findUniqueMock.mockResolvedValueOnce(null);
    const s = await getEffectiveSession();
    expect(s?.isImpersonating).toBe(false);
    expect(s?.user.id).toBe(adminUser.id);
  });

  it('passes deletedAt: null in the where clause so soft-deleted targets are not impersonated', async () => {
    authMock.mockResolvedValueOnce({ user: adminUser });
    readCookieMock.mockResolvedValueOnce(impersonationClaims);
    findUniqueMock.mockResolvedValueOnce(therapistUser);
    await getEffectiveSession();
    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: therapistUser.id, deletedAt: null }),
      }),
    );
  });
});
