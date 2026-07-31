import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rateLimitMock,
  validateTokenMock,
  checkInByNameMock,
  listTodaysMock,
  recordCheckInMock,
  requirePermissionMock,
  updateAppt,
  updateSettings,
} = vi.hoisted(() => ({
  rateLimitMock: vi.fn(async () => ({ allowed: true, count: 1, remainingTtlSeconds: 60 })),
  validateTokenMock: vi.fn(async () => true),
  checkInByNameMock: vi.fn(async () => ({
    kind: 'CHECKED_IN',
    firstName: 'Abdullah',
    delayMinutes: 10,
    appointmentCount: 1,
  })),
  listTodaysMock: vi.fn(async () => [
    {
      patientId: 'pat-1',
      fullNameEn: 'Abdullah',
      fullNameAr: 'عبدالله',
      appointments: [],
    },
  ]),
  recordCheckInMock: vi.fn(async () => ({ kind: 'CHECKED_IN' })),
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
  checkInByName: checkInByNameMock,
  listTodaysArrivalRows: listTodaysMock,
  manualCheckIn: recordCheckInMock,
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
  kioskCheckInByNameAction,
  kioskTodayAction,
  manualCheckInAction,
  setCurrentDelayAction,
  undoCheckInAction,
} from '../actions';

const TOKEN = 'k'.repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ allowed: true, count: 1, remainingTtlSeconds: 60 });
  validateTokenMock.mockResolvedValue(true);
  checkInByNameMock.mockResolvedValue({
    kind: 'CHECKED_IN',
    firstName: 'Abdullah',
    delayMinutes: 10,
    appointmentCount: 1,
  });
  requirePermissionMock.mockResolvedValue(undefined);
});

describe('kioskTodayAction — gating (July 31 rows list)', () => {
  it('denies an invalid token without listing', async () => {
    validateTokenMock.mockResolvedValue(false);
    const res = await kioskTodayAction({ token: TOKEN });
    expect(res).toEqual({ kind: 'INVALID_TOKEN' });
    expect(listTodaysMock).not.toHaveBeenCalled();
  });

  it('rate-limits before listing', async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, count: 99, remainingTtlSeconds: 50 });
    const res = await kioskTodayAction({ token: TOKEN });
    expect(res).toEqual({ kind: 'RATE_LIMITED' });
    expect(listTodaysMock).not.toHaveBeenCalled();
  });

  it("returns the day's rows when token + rate-limit pass", async () => {
    const res = await kioskTodayAction({ token: TOKEN });
    expect(res).toMatchObject({ kind: 'ROWS' });
    expect(listTodaysMock).toHaveBeenCalled();
  });
});

describe('kioskCheckInByNameAction — gating (July #1 confirm → commit)', () => {
  it('denies an invalid token without committing', async () => {
    validateTokenMock.mockResolvedValue(false);
    const res = await kioskCheckInByNameAction({ token: TOKEN, patientId: 'pat-1' });
    expect(res).toEqual({ kind: 'INVALID_TOKEN' });
    expect(checkInByNameMock).not.toHaveBeenCalled();
  });

  it('rate-limits before committing', async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, count: 11, remainingTtlSeconds: 50 });
    const res = await kioskCheckInByNameAction({ token: TOKEN, patientId: 'pat-1' });
    expect(res).toEqual({ kind: 'RATE_LIMITED' });
    expect(checkInByNameMock).not.toHaveBeenCalled();
  });

  it('commits by patientId when token + rate-limit pass', async () => {
    const res = await kioskCheckInByNameAction({ token: TOKEN, patientId: 'pat-1' });
    expect(res).toMatchObject({ kind: 'CHECKED_IN' });
    expect(checkInByNameMock).toHaveBeenCalledWith({
      patientId: 'pat-1',
      appointmentId: undefined,
    });
  });

  it('forwards the tapped row anchor to the commit (July 31 item 2)', async () => {
    await kioskCheckInByNameAction({ token: TOKEN, patientId: 'pat-1', appointmentId: 'appt-9' });
    expect(checkInByNameMock).toHaveBeenCalledWith({ patientId: 'pat-1', appointmentId: 'appt-9' });
  });
});

describe('staff arrivals actions', () => {
  it('manual check-in runs the service (STAFF via + arrival seam) and requires arrivals.manage', async () => {
    const res = await manualCheckInAction({ appointmentId: 'appt-1' });
    expect(res.ok).toBe(true);
    expect(requirePermissionMock).toHaveBeenCalledWith('arrivals.manage');
    expect(recordCheckInMock).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'appt-1', actorId: 'sec-1' }),
    );
  });

  it('manual check-in surfaces NOT_FOUND as a failed Result', async () => {
    recordCheckInMock.mockResolvedValue({ kind: 'NOT_FOUND' });
    const res = await manualCheckInAction({ appointmentId: 'ghost' });
    expect(res.ok).toBe(false);
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
