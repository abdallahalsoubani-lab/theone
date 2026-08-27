import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P52 — the atomic new-patient booking: create patient + intake link +
 * appointment in one transaction (no orphan patient, no half-booking),
 * conflict block. P57: the duplicate-phone HARD BLOCK is gone (clinic-
 * approved reversal of P52 owner decision 5) — a held number is a confirm.
 */

const state = {
  // P57 — every ACTIVE patient already holding the number.
  holders: [] as Array<{ id: string; fullNameEn: string; fullNameAr: string }>,
  conflicts: { ok: true } as { ok: boolean; conflicts?: unknown[] },
  created: {
    users: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
    appts: [] as Array<Record<string, unknown>>,
    links: [] as Array<Record<string, unknown>>,
  },
  txThrows: false,
};

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'sec-1' } })) }));
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_cfg: unknown, fn: unknown) => fn }));
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async () => 'hash') }));
vi.mock('@/lib/admin/temp-password', () => ({ generateTempPassword: vi.fn(() => 'Temp@123') }));
vi.mock('@/lib/patients/shared-phone', () => ({
  findSharedPhoneHolders: vi.fn(async () => state.holders),
  sharedPhoneHolderNames: (h: Array<{ fullNameEn: string }>) =>
    h.map((x) => x.fullNameEn).join(', '),
}));
vi.mock('@/lib/format/phone', () => ({ normalizeJordanPhone: (p: string) => `+962${p}` }));
vi.mock('@/lib/format/patientName', () => ({
  patientDisplayName: (en: string) => en,
}));
vi.mock('@/lib/patients/assignment', () => ({ addCareTeamMemberTx: vi.fn(async () => undefined) }));
vi.mock('@/lib/intake-links/tokens', () => ({ generateIntakeToken: () => 'tok_'.padEnd(43, 'x') }));
vi.mock('../session-timing', () => ({ isStartInPast: () => false }));
vi.mock('../services', () => ({
  getReminderConfig: vi.fn(async () => ({
    offsetMinutes: 1440,
    windowStartMinutes: 480,
    windowEndMinutes: 1080,
    timeZone: 'Asia/Amman',
  })),
  // P53 — the booking routes reminders through the per-patient-per-day
  // resync; stand it in for the direct enqueue so the "one reminder" and
  // rollback assertions keep their meaning.
  resyncPatientDayReminders: (...a: unknown[]) => resyncMock(...(a as [])),
}));
const { checkConflictsMock, reminderMock, resyncMock, dispatchMock } = vi.hoisted(() => ({
  checkConflictsMock: vi.fn(async () => ({ ok: true }) as { ok: boolean; conflicts?: unknown[] }),
  reminderMock: vi.fn(async () => 'job'),
  resyncMock: vi.fn(async () => undefined),
  dispatchMock: vi.fn(async () => ({ entryId: 'd1', suppressed: null, confirmWasPending: false })),
}));
vi.mock('../conflicts', () => ({
  checkConflicts: (...a: unknown[]) => checkConflictsMock(...(a as [])),
  hasHardBlockedConflict: () => false,
}));
vi.mock('@/lib/queue/jobs/appointmentReminder', () => ({
  enqueueAppointmentReminder: reminderMock,
}));
vi.mock('@/lib/whatsapp/dispatch/service', () => ({ recordDispatchEvent: dispatchMock }));

vi.mock('@/lib/db', () => {
  let seq = 0;
  const tx = {
    user: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.created.users.push(data);
        return { id: `pat-${++seq}` };
      }),
    },
    patientProfile: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.created.profiles.push(data);
      }),
    },
    appointment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.created.appts.push(data);
        return { id: `appt-${seq}` };
      }),
    },
    patientIntakeLink: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.txThrows) throw new Error('boom');
        state.created.links.push(data);
      }),
    },
  };
  return {
    db: {
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    },
    toLocalizedError: (e: unknown) => ({ code: 'X', message_en: String(e), message_ar: '' }),
  };
});

import { createNewPatientBooking, NewPatientBookingError } from '../new-patient-booking';
import { PLACEHOLDER_DOB } from '@/lib/patients/placeholder-dob';

const input = (over: Record<string, unknown> = {}) => ({
  fullNameEn: 'Ahmad Ali',
  phone: '0790000000',
  formType: 'ADULT' as const,
  appointmentType: 'SESSION' as const,
  therapistIds: ['t1'],
  roomId: 'r1',
  startsAt: new Date('2030-05-10T08:00:00Z'),
  durationMinutes: 60,
  notes: null,
  overrideConflicts: false,
  confirmSharedPhone: false,
  ...over,
});

beforeEach(() => {
  state.holders = [];
  state.conflicts = { ok: true };
  state.created = { users: [], profiles: [], appts: [], links: [] };
  state.txThrows = false;
  vi.clearAllMocks();
  checkConflictsMock.mockResolvedValue(state.conflicts);
});

describe('createNewPatientBooking — atomic happy path', () => {
  it('creates patient + profile + appointment + intake link, then reminder + confirmation', async () => {
    const r = await createNewPatientBooking(input());
    expect(state.created.users).toHaveLength(1);
    expect(state.created.profiles).toHaveLength(1);
    expect(state.created.appts).toHaveLength(1);
    expect(state.created.links).toHaveLength(1);
    // Patient minimal: English name only, AR '', DOB sentinel, gender null.
    expect(state.created.users[0]).toMatchObject({ fullNameEn: 'Ahmad Ali', fullNameAr: '' });
    expect(state.created.profiles[0]!.gender).toBeNull();
    expect(state.created.profiles[0]!.dateOfBirth).toEqual(PLACEHOLDER_DOB);
    // The link is tied to the appointment + carries the form type.
    expect(state.created.links[0]).toMatchObject({
      formType: 'ADULT',
      appointmentId: r.appointmentId,
    });
    // Confirmation dispatch fired for the new patient (combined template is
    // chosen later, at fire time, by the presence of the link).
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BOOKING_CONFIRMATION', patientId: r.patientId }),
    );
    expect(resyncMock).toHaveBeenCalledTimes(1);
  });
});

describe('createNewPatientBooking — shared phone is a CONFIRM, never a block (P57)', () => {
  it('an unconfirmed submit against a held number fails with PATIENT_PHONE_SHARED_CONFIRM naming the holder — nothing created', async () => {
    state.holders = [{ id: 'pat-existing', fullNameEn: 'Sara', fullNameAr: 'سارة' }];
    const err = await createNewPatientBooking(input()).catch((e) => e);
    expect(err).toBeInstanceOf(NewPatientBookingError);
    expect(err.error.code).toBe('PATIENT_PHONE_SHARED_CONFIRM');
    expect(err.error.message_en).toContain('Sara');
    expect(err.error.details.holders).toEqual([{ id: 'pat-existing', name: 'Sara' }]);
    expect(state.created.users).toHaveLength(0);
    expect(state.created.appts).toHaveLength(0);
  });

  it('a number already shared by TWO siblings is also just a confirm (was PATIENT_PHONE_AMBIGUOUS)', async () => {
    state.holders = [
      { id: 'child-a', fullNameEn: 'Ahmad', fullNameAr: '' },
      { id: 'child-b', fullNameEn: 'Sara', fullNameAr: '' },
    ];
    const err = await createNewPatientBooking(input()).catch((e) => e);
    expect(err.error.code).toBe('PATIENT_PHONE_SHARED_CONFIRM');
    expect(err.error.details.holders).toHaveLength(2);
    expect(state.created.users).toHaveLength(0);
  });

  it('confirmed → creates the second (and third) patient on the same number', async () => {
    state.holders = [
      { id: 'child-a', fullNameEn: 'Ahmad', fullNameAr: '' },
      { id: 'child-b', fullNameEn: 'Sara', fullNameAr: '' },
    ];
    const result = await createNewPatientBooking(input({ confirmSharedPhone: true }));
    expect(result.patientId).toBeTruthy();
    expect(state.created.users).toHaveLength(1);
    expect(state.created.appts).toHaveLength(1);
    expect(state.created.links).toHaveLength(1);
  });
});

describe('createNewPatientBooking — conflict block', () => {
  it('a conflict without override throws and creates nothing', async () => {
    state.conflicts = { ok: false, conflicts: [{ kind: 'THERAPIST_OVERLAP' }] };
    checkConflictsMock.mockResolvedValue(state.conflicts);
    const err = await createNewPatientBooking(input()).catch((e) => e);
    expect(err.error.code).toBe('APPOINTMENT_CONFLICT');
    expect(state.created.users).toHaveLength(0);
  });
});

describe('createNewPatientBooking — atomicity (no orphan)', () => {
  it('a failure creating the link aborts the whole transaction (no orphan patient/appointment persisted)', async () => {
    // The tx callback throws at the link step; db.$transaction re-throws, so
    // the create surfaces an error and — because it is ONE transaction — a
    // real DB would roll back the user + appointment too.
    state.txThrows = true;
    await expect(createNewPatientBooking(input())).rejects.toBeTruthy();
    expect(state.created.links).toHaveLength(0);
    // No reminder / confirmation fired (they run only after a committed tx).
    expect(resyncMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
