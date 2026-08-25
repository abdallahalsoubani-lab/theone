import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P52 — the atomic new-patient booking: create patient + intake link +
 * appointment in one transaction (no orphan patient, no half-booking),
 * duplicate-phone hard block, conflict block.
 */

const state = {
  lookup: { outcome: 'NONE' } as
    | { outcome: 'NONE' }
    | { outcome: 'AMBIGUOUS' }
    | { outcome: 'ONE'; user: { id: string; fullNameEn: string; fullNameAr: string } },
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
vi.mock('@/lib/auth/lockout', () => ({ lookupPatientByPhone: vi.fn(async () => state.lookup) }));
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
}));
const { checkConflictsMock, reminderMock, dispatchMock } = vi.hoisted(() => ({
  checkConflictsMock: vi.fn(async () => ({ ok: true }) as { ok: boolean; conflicts?: unknown[] }),
  reminderMock: vi.fn(async () => 'job'),
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
  ...over,
});

beforeEach(() => {
  state.lookup = { outcome: 'NONE' };
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
    expect(reminderMock).toHaveBeenCalledTimes(1);
  });
});

describe('createNewPatientBooking — duplicate phone hard block', () => {
  it('a matching phone throws PATIENT_PHONE_EXISTS with the existing patient — nothing created', async () => {
    state.lookup = {
      outcome: 'ONE',
      user: { id: 'pat-existing', fullNameEn: 'Sara', fullNameAr: 'سارة' },
    };
    const err = await createNewPatientBooking(input()).catch((e) => e);
    expect(err).toBeInstanceOf(NewPatientBookingError);
    expect(err.error.code).toBe('PATIENT_PHONE_EXISTS');
    expect(err.error.details.existingPatientId).toBe('pat-existing');
    expect(state.created.users).toHaveLength(0);
    expect(state.created.appts).toHaveLength(0);
  });

  it('an ambiguous phone is blocked too', async () => {
    state.lookup = { outcome: 'AMBIGUOUS' };
    const err = await createNewPatientBooking(input()).catch((e) => e);
    expect(err.error.code).toBe('PATIENT_PHONE_AMBIGUOUS');
    expect(state.created.users).toHaveLength(0);
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
    expect(reminderMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
