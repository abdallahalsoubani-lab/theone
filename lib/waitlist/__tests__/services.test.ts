import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createNotificationMock,
  waitlistFindMany,
  waitlistUpdateMany,
  waitlistFindUnique,
  userFindMany,
  settingsFindUnique,
  auditCreate,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(async () => ({ id: 'n1' })),
  waitlistFindMany: vi.fn(),
  waitlistUpdateMany: vi.fn(),
  waitlistFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  settingsFindUnique: vi.fn(async (..._a: unknown[]) => ({ timezone: 'Asia/Amman' })),
  auditCreate: vi.fn(async (..._a: unknown[]) => ({})),
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'sec-1' } })) }));
vi.mock('@/lib/notifications/actions', () => ({ createNotification: createNotificationMock }));
vi.mock('@/lib/db', () => ({
  db: {
    waitlistEntry: {
      findMany: (...a: unknown[]) => waitlistFindMany(...a),
      updateMany: (...a: unknown[]) => waitlistUpdateMany(...a),
      findUnique: (...a: unknown[]) => waitlistFindUnique(...a),
      create: vi.fn(async () => ({ id: 'w-new' })),
      update: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    clinicSettings: { findUnique: (...a: unknown[]) => settingsFindUnique(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
  toLocalizedError: (e: unknown) => ({ code: 'ERR', message_en: String(e), message_ar: String(e) }),
}));

import { WaitlistError } from '../errors';
import {
  expirePastWaitlistEntries,
  fulfillWaitlistEntry,
  notifyWaitlistForFreedSlot,
} from '../services';

const NOW = new Date('2026-06-19T00:00:00Z');

function waitingRow(over: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    windowStart: new Date('2026-06-20T13:00:00Z'),
    windowEnd: new Date('2026-06-20T14:00:00Z'),
    preferredTherapistId: null,
    status: 'WAITING',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    patient: { fullNameEn: 'Sara', fullNameAr: 'سارة' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsFindUnique.mockResolvedValue({ timezone: 'Asia/Amman' });
  userFindMany.mockResolvedValue([
    { id: 'sec-1', languagePref: 'EN' },
    { id: 'adm-1', languagePref: 'AR' },
  ]);
});

describe('notifyWaitlistForFreedSlot', () => {
  it('notifies SECRETARY + ADMIN when a freed slot matches (cancel/no-show path)', async () => {
    waitlistFindMany.mockResolvedValue([waitingRow()]);
    const res = await notifyWaitlistForFreedSlot(
      { startsAt: new Date('2026-06-20T13:00:00Z'), therapistId: 'th-1' },
      NOW,
    );
    expect(res.matched).toBe(1);
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BOOKING_WAITLIST_SLOT_FREED',
        recipientId: 'sec-1',
        linkPath: '/secretary/waitlist',
        relatedEntityId: 'w1',
      }),
    );
  });

  it('stays silent when no entry overlaps the freed slot', async () => {
    waitlistFindMany.mockResolvedValue([
      waitingRow({
        windowStart: new Date('2026-06-20T10:00:00Z'),
        windowEnd: new Date('2026-06-20T10:30:00Z'),
      }),
    ]);
    const res = await notifyWaitlistForFreedSlot(
      { startsAt: new Date('2026-06-20T16:00:00Z'), therapistId: 'th-1' },
      NOW,
    );
    expect(res.matched).toBe(0);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('stays silent when the only match prefers a different therapist', async () => {
    waitlistFindMany.mockResolvedValue([waitingRow({ preferredTherapistId: 'th-2' })]);
    const res = await notifyWaitlistForFreedSlot(
      { startsAt: new Date('2026-06-20T13:00:00Z'), therapistId: 'th-1' },
      NOW,
    );
    expect(res.matched).toBe(0);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});

describe('fulfillWaitlistEntry', () => {
  it('marks the entry FULFILLED and links the appointment', async () => {
    waitlistUpdateMany.mockResolvedValueOnce({ count: 1 });
    const res = await fulfillWaitlistEntry({ entryId: 'w1', appointmentId: 'appt-1' }, 'sec-1');
    expect(res).toEqual({ id: 'w1', appointmentId: 'appt-1' });
    expect(waitlistUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'w1', status: 'WAITING' },
        data: expect.objectContaining({ status: 'FULFILLED', fulfilledAppointmentId: 'appt-1' }),
      }),
    );
  });

  it('rejects a second placement on an already-fulfilled entry', async () => {
    waitlistUpdateMany.mockResolvedValueOnce({ count: 0 });
    waitlistFindUnique.mockResolvedValueOnce({ id: 'w1' });
    await expect(
      fulfillWaitlistEntry({ entryId: 'w1', appointmentId: 'appt-2' }, 'sec-1'),
    ).rejects.toMatchObject({ error: { code: 'WAITLIST_ALREADY_FULFILLED' } });
    expect(WaitlistError).toBeDefined();
  });
});

describe('expirePastWaitlistEntries', () => {
  it('flips passed WAITING entries to EXPIRED', async () => {
    waitlistUpdateMany.mockResolvedValueOnce({ count: 3 });
    const n = await expirePastWaitlistEntries(NOW);
    expect(n).toBe(3);
    expect(waitlistUpdateMany).toHaveBeenCalledWith({
      where: { status: 'WAITING', windowEnd: { lte: NOW } },
      data: { status: 'EXPIRED' },
    });
  });
});
