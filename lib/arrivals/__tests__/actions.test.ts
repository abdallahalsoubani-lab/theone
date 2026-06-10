import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rateLimitMock,
  validateTokenMock,
  checkInByPhoneMock,
  recordCheckInMock,
  requirePermissionMock,
  updateAppt,
  updateSettings,
} = vi.hoisted(() => ({
  rateLimitMock: vi.fn(async () => ({ allowed: true, count: 1, remainingTtlSeconds: 60 })),
  validateTokenMock: vi.fn(async () => true),
  checkInByPhoneMock: vi.fn(async () => ({
    kind: 'CHECKED_IN',
    firstName: 'Abdullah',
    delayMinutes: 10,
  })),
  recordCheckInMock: vi.fn(async () => undefined),
  requirePermissionMock: vi.fn(async () => undefined),
  updateAppt: vi.fn(async (..._args: unknown[]) => ({})),
  updateSettings: vi.fn(async (..._args: unknown[]) => ({})),
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'sec-1' } })) }));
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => ({ user: { id: 'sec-1' }, isImpersonating: false })),
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => '1.2.3.4' })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/rate-limit', () => ({ rateLimit: rateLimitMock }));
vi.mock('@/lib/rbac/guards', () => ({ requirePermission: requirePermissionMock }));
vi.mock('@/lib/arrivals/tokens', () => ({
  validateArrivalsToken: validateTokenMock,
  generateAccessToken: () => 'x'.repeat(32),
}));
vi.mock('@/lib/arrivals/kiosk', () => ({
  checkInByPhone: checkInByPhoneMock,
  recordCheckIn: recordCheckInMock,
}));

vi.mock('@/lib/db', () => ({
  db: {
    appointment: { update: (...a: unknown[]) => updateAppt(...a) },
    clinicSettings: { update: (...a: unknown[]) => updateSettings(...a) },
    auditLog: { create: vi.fn(async () => ({})) },
  },
  toLocalizedError: (e: unknown) => ({ code: 'ERR', message_en: String(e), message_ar: String(e) }),
}));

import {
  kioskCheckInAction,
  manualCheckInAction,
  setCurrentDelayAction,
  undoCheckInAction,
} from '../actions';

const TOKEN = 'k'.repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, count: 1, remainingTtlSeconds: 60 });
  validateTokenMock.mockResolvedValue(true);
  checkInByPhoneMock.mockResolvedValue({
    kind: 'CHECKED_IN',
    firstName: 'Abdullah',
    delayMinutes: 10,
  });
  requirePermissionMock.mockResolvedValue(undefined);
});

describe('kioskCheckInAction — gating', () => {
  it('denies an invalid token without touching the matcher', async () => {
    validateTokenMock.mockResolvedValue(false);
    const res = await kioskCheckInAction({ token: TOKEN, phone: '0790123456' });
    expect(res).toEqual({ kind: 'INVALID_TOKEN' });
    expect(checkInByPhoneMock).not.toHaveBeenCalled();
  });

  it('rate-limits after the cap, before matching', async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, count: 11, remainingTtlSeconds: 50 });
    const res = await kioskCheckInAction({ token: TOKEN, phone: '0790123456' });
    expect(res).toEqual({ kind: 'RATE_LIMITED' });
    expect(checkInByPhoneMock).not.toHaveBeenCalled();
  });

  it('delegates to the matcher when token + rate-limit pass', async () => {
    const res = await kioskCheckInAction({ token: TOKEN, phone: '0790123456' });
    expect(res).toMatchObject({ kind: 'CHECKED_IN' });
    expect(checkInByPhoneMock).toHaveBeenCalledWith({ phone: '0790123456' });
  });
});

describe('staff arrivals actions', () => {
  it('manual check-in records STAFF via and requires arrivals.manage', async () => {
    const res = await manualCheckInAction({ appointmentId: 'appt-1' });
    expect(res.ok).toBe(true);
    expect(requirePermissionMock).toHaveBeenCalledWith('arrivals.manage');
    expect(recordCheckInMock).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'appt-1', via: 'STAFF', actorId: 'sec-1' }),
    );
  });

  it('undo check-in clears the columns', async () => {
    const res = await undoCheckInAction({ appointmentId: 'appt-1' });
    expect(res.ok).toBe(true);
    expect(updateAppt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-1' },
        data: expect.objectContaining({ checkedInAt: null, checkedInVia: null }),
      }),
    );
  });

  it('set-delay writes currentDelayMinutes (audited path)', async () => {
    const res = await setCurrentDelayAction({ minutes: 25 });
    expect(res.ok).toBe(true);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentDelayMinutes: 25 }) }),
    );
  });

  it('rejects an out-of-range delay', async () => {
    const res = await setCurrentDelayAction({ minutes: 9999 });
    expect(res.ok).toBe(false);
  });
});
