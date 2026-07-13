import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, userFindUnique, userUpdate, auditCreate, effectiveSessionMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    userFindUnique: vi.fn(),
    userUpdate: vi.fn(async (..._a: unknown[]) => ({})),
    auditCreate: vi.fn(async (..._a: unknown[]) => ({})),
    effectiveSessionMock: vi.fn(),
  }),
);

vi.mock('@/auth', () => ({ auth: (...a: unknown[]) => authMock(...a) }));
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: (...a: unknown[]) => effectiveSessionMock(...a),
}));
vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { authConfig } from '@/lib/auth/config';
import { authEdgeConfig } from '@/lib/auth/edge-config';

import { ChangePasswordError, changePassword } from '../services/changePassword';

const TEMP = 'Temp@123x';
const NEW = 'NewPass@123!';

beforeEach(async () => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  effectiveSessionMock.mockResolvedValue({ isImpersonating: false, user: { id: 'u1' } });
  userFindUnique.mockResolvedValue({ id: 'u1', passwordHash: await bcrypt.hash(TEMP, 4) });
});

describe('changePassword (forced first-login flow, QA 2.1)', () => {
  it('happy path: rotates the hash, clears mustChangePassword, audits without secrets', async () => {
    const result = await changePassword({ currentPassword: TEMP, newPassword: NEW });
    expect(result).toEqual({ userId: 'u1' });

    expect(userUpdate).toHaveBeenCalledTimes(1);
    const update = userUpdate.mock.calls[0]![0] as {
      data: { passwordHash: string; mustChangePassword: boolean };
    };
    expect(update.data.mustChangePassword).toBe(false);
    expect(await bcrypt.compare(NEW, update.data.passwordHash)).toBe(true);

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const audit = auditCreate.mock.calls[0]![0] as { data: { after: unknown } };
    expect(audit.data.after).toEqual({ event: 'PASSWORD_CHANGED' });
    expect(JSON.stringify(audit.data)).not.toContain(NEW);
  });

  it('rejects a wrong current password with INVALID_CREDENTIALS and does not write', async () => {
    await expect(
      changePassword({ currentPassword: 'Wrong@123', newPassword: NEW }),
    ).rejects.toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects a weak new password with WEAK_PASSWORD', async () => {
    await expect(
      changePassword({ currentPassword: TEMP, newPassword: 'short' }),
    ).rejects.toBeInstanceOf(ChangePasswordError);
    await expect(
      changePassword({ currentPassword: TEMP, newPassword: 'short' }),
    ).rejects.toMatchObject({ error: { code: 'WEAK_PASSWORD' } });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('rejects when unauthenticated (denial case for this self-service action)', async () => {
    authMock.mockResolvedValue(null);
    await expect(changePassword({ currentPassword: TEMP, newPassword: NEW })).rejects.toMatchObject(
      { error: { code: 'UNAUTHENTICATED' } },
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe('jwt callback trigger=update patches mustChangePassword (both configs)', () => {
  // The ChangePasswordForm fix relies on update({ mustChangePassword: false })
  // re-signing the cookie; pin the behavior in BOTH configs so the node and
  // edge variants cannot silently diverge (the middleware reads the edge one).
  const staleToken = () => ({
    userId: 'u1',
    role: 'DOCTOR',
    languagePref: 'AR',
    mustChangePassword: true,
    fullNameEn: 'Dr',
    fullNameAr: 'د',
  });

  for (const [name, config] of [
    ['authConfig', authConfig],
    ['authEdgeConfig', authEdgeConfig],
  ] as const) {
    it(`${name}: update() clears the stale flag so the middleware stops bouncing`, async () => {
      const jwt = config.callbacks!.jwt!;
      const token = (await jwt({
        token: staleToken(),
        trigger: 'update',
        session: { mustChangePassword: false },
        // Only token/trigger/session participate in the update path.
      } as never)) as Record<string, unknown>;
      expect(token.mustChangePassword).toBe(false);
      expect(token.role).toBe('DOCTOR');
    });
  }
});
