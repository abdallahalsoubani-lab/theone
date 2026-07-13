import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 22 §3.2 — Act-As policy pins:
 *   - ADMIN keeps Act-As for staff AND patients (decision b).
 *   - SECRETARY (and every other non-admin role) is denied server-side.
 *   - start/end always write IMPERSONATION_STARTED / _ENDED audit rows.
 */

const sessionRef: { current: { user: { id: string; role: string } } | null } = { current: null };
vi.mock('@/auth', () => ({ auth: vi.fn(async () => sessionRef.current) }));

const { cookieRef, setCookieMock, clearCookieMock, userFindUnique, auditCreate } = vi.hoisted(
  () => ({
    cookieRef: {
      current: null as { adminId: string; targetUserId: string; targetRole: string } | null,
    },
    setCookieMock: vi.fn(async (_c: unknown) => {}),
    clearCookieMock: vi.fn(async () => {}),
    userFindUnique: vi.fn(),
    auditCreate: vi.fn(async (..._a: unknown[]) => ({})),
  }),
);

vi.mock('../cookie', () => ({
  readImpersonationCookie: vi.fn(async () => cookieRef.current),
  setImpersonationCookie: (a: unknown) => setCookieMock(a),
  clearImpersonationCookie: () => clearCookieMock(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { endImpersonationAction, startImpersonationAction } from '../actions';

beforeEach(() => {
  vi.clearAllMocks();
  sessionRef.current = null;
  cookieRef.current = null;
  userFindUnique.mockResolvedValue({ id: 'patient-1', role: 'PATIENT' });
});

describe('startImpersonationAction — RBAC', () => {
  it.each(['SECRETARY', 'DOCTOR', 'THERAPIST', 'PATIENT'] as const)(
    'denies %s server-side: no cookie, no audit row',
    async (role) => {
      sessionRef.current = { user: { id: 'u-x', role } };
      const res = await startImpersonationAction({ targetUserId: 'patient-1' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('FORBIDDEN_NOT_ADMIN');
      expect(setCookieMock).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    },
  );

  it('denies unauthenticated callers', async () => {
    const res = await startImpersonationAction({ targetUserId: 'patient-1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('startImpersonationAction — ADMIN happy paths', () => {
  beforeEach(() => {
    sessionRef.current = { user: { id: 'admin-1', role: 'ADMIN' } };
  });

  it('Admin → PATIENT works (decision: Admin keeps patient Act-As) and audits', async () => {
    const res = await startImpersonationAction({ targetUserId: 'patient-1' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.targetRole).toBe('PATIENT');
      expect(res.data.redirectTo).toBe('/patient/dashboard');
    }
    expect(setCookieMock).toHaveBeenCalledWith({
      adminId: 'admin-1',
      targetUserId: 'patient-1',
      targetRole: 'PATIENT',
    });
    const audit = auditCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(audit.data.action).toBe('IMPERSONATION_STARTED');
    expect(audit.data.actorId).toBe('admin-1');
    expect(audit.data.impersonatedUserId).toBe('patient-1');
  });

  it('rejects impersonating another ADMIN', async () => {
    userFindUnique.mockResolvedValue({ id: 'admin-2', role: 'ADMIN' });
    const res = await startImpersonationAction({ targetUserId: 'admin-2' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CANNOT_IMPERSONATE_ADMIN');
  });

  it('rejects a second start while one is active', async () => {
    cookieRef.current = { adminId: 'admin-1', targetUserId: 'x', targetRole: 'DOCTOR' };
    const res = await startImpersonationAction({ targetUserId: 'patient-1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ALREADY_IMPERSONATING');
  });

  it('rejects a missing/deleted target', async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await startImpersonationAction({ targetUserId: 'ghost' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('USER_NOT_FOUND');
  });
});

describe('endImpersonationAction', () => {
  it('writes IMPERSONATION_ENDED and clears the cookie for the issuing admin', async () => {
    sessionRef.current = { user: { id: 'admin-1', role: 'ADMIN' } };
    cookieRef.current = { adminId: 'admin-1', targetUserId: 'patient-1', targetRole: 'PATIENT' };
    const res = await endImpersonationAction();
    expect(res.ok).toBe(true);
    const audit = auditCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(audit.data.action).toBe('IMPERSONATION_ENDED');
    expect(clearCookieMock).toHaveBeenCalled();
  });

  it('still clears the cookie without a session (no audit row)', async () => {
    const res = await endImpersonationAction();
    expect(res.ok).toBe(false);
    expect(clearCookieMock).toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
