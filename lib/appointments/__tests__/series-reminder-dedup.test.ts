import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P50 (series 45+) §3.2–3.3 — same-day reminder dedup across a series'
 * lifecycle (the pure picker is tested in reminderWindow.test.ts; this file
 * pins the WIRING in services.ts):
 *   - cancelling the reminded (earliest) same-day occurrence → the next
 *     sibling of that clinic day INHERITS the reminder (re-enqueued);
 *   - cancelling a non-reminded sibling → the earliest keeps its job, the
 *     cancelled one's job is removed, nothing else changes;
 *   - a non-series cancel never touches siblings (no series query at all);
 *   - rescheduling a series occurrence re-runs the dedup for the old and
 *     the new day (a sibling moved onto a day that already has an earlier
 *     occurrence gets NO reminder of its own);
 *   - a non-series reschedule keeps the plain re-enqueue;
 *   - dispatch-control settings (AUTO/MANUAL) never enter any of this.
 */

const { enqueueMock, cancelReminderMock, findManyMock, findUniqueMock, clinicSettingsMock } =
  vi.hoisted(() => ({
    enqueueMock: vi.fn(async () => 'job'),
    cancelReminderMock: vi.fn(async () => undefined),
    findManyMock: vi.fn(async (): Promise<unknown[]> => []),
    findUniqueMock: vi.fn(async (): Promise<unknown> => null),
    clinicSettingsMock: vi.fn(async () => ({
      defaultReminderOffsetMinutes: 1440,
      reminderWindowStart: '08:00',
      reminderWindowEnd: '18:00',
      timezone: 'Asia/Amman',
    })),
  }));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'sec-1', role: 'SECRETARY' } })),
}));
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_cfg: unknown, fn: unknown) => fn }));
vi.mock('@/lib/queue/jobs/appointmentReminder', () => ({
  enqueueAppointmentReminder: enqueueMock,
  cancelAppointmentReminder: cancelReminderMock,
  scheduleLifecycleMessage: vi.fn(async () => null),
  cancelLifecycleMessages: vi.fn(async () => ({ confirmWasPending: false })),
}));
vi.mock('@/lib/queue/jobs/autoCompleteSession', () => ({
  enqueueAutoCompleteSession: vi.fn(),
  cancelAutoCompleteSession: vi.fn(),
}));
const dispatchMock = vi.hoisted(() =>
  vi.fn(async () => ({ entryId: 'd1', suppressed: null, confirmWasPending: false })),
);
vi.mock('@/lib/whatsapp/dispatch/service', () => ({ recordDispatchEvent: dispatchMock }));
vi.mock('@/lib/patients/assignment', () => ({ addCareTeamMemberTx: vi.fn() }));
vi.mock('@/lib/waitlist/services', () => ({ notifyWaitlistForFreedSlot: vi.fn() }));
vi.mock('@/lib/time/clinic-server', () => ({ getClinicTimeZone: vi.fn(async () => 'Asia/Amman') }));
vi.mock('../conflicts', () => ({
  checkConflicts: vi.fn(async () => ({ ok: true, conflicts: [] })),
  hasHardBlockedConflict: () => false,
  hasSamePatientOverlap: () => false,
}));
vi.mock('@/lib/whatsapp/templates/sendConfirmation', () => ({
  confirmationAlreadySent: vi.fn(async () => true),
  sendAppointmentConfirmation: vi.fn(async () => undefined),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    appointment: { update: vi.fn(async () => undefined) },
    appointmentTherapist: {
      findMany: vi.fn(async () => [{ therapistId: 't1' }]),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    db: {
      appointment: {
        findUnique: findUniqueMock,
        findMany: findManyMock,
        update: vi.fn(async () => undefined),
      },
      appointmentTherapist: { findMany: vi.fn(async () => [{ therapistId: 't1' }]) },
      clinicSettings: { findUnique: clinicSettingsMock },
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    },
    toLocalizedError: (e: unknown) => e,
  };
});

import { cancelAppointment, rescheduleAppointment } from '../services';

// One Amman clinic day (UTC+3): 10 Mar 2030 — 09:00 / 11:00 / 15:00 local.
const D1_EARLY = new Date('2030-03-10T06:00:00Z');
const D1_MID = new Date('2030-03-10T08:00:00Z');
const D1_LATE = new Date('2030-03-10T12:00:00Z');
const D2 = new Date('2030-03-11T06:00:00Z');

const patient = {
  phone: '+962790000000',
  languagePref: 'AR',
  whatsappReachable: true,
  fullNameEn: 'Test',
  fullNameAr: 'اختبار',
};

const apptRow = (id: string, startsAt: Date, seriesId: string | null = 'ser_1') => ({
  id,
  status: 'SCHEDULED',
  startsAt,
  seriesId,
  patientId: 'p1',
  patient,
  therapists: [{ therapistId: 't1' }],
  appointmentType: 'SESSION',
  roomId: 'r1',
  groupPatients: [],
});

const enqueuedIds = () =>
  (enqueueMock.mock.calls as unknown as Array<[{ appointmentId: string }]>).map(
    (c) => c[0].appointmentId,
  );
const cancelledIds = () =>
  (cancelReminderMock.mock.calls as unknown as Array<[string]>).map((c) => c[0]);

const cancelInput = (id: string) => ({
  id,
  cancellationReason: 'patient request',
  cancellationCategory: 'PATIENT_REQUEST' as const,
  cancellationNotes: null,
  notifyPatient: false,
  seriesMode: 'ONE' as const,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cancel — the next same-day sibling inherits the reminder (§3.3)', () => {
  it('cancelling the reminded (earliest) occurrence re-enqueues the next one of that day', async () => {
    findUniqueMock.mockResolvedValue(apptRow('a-early', D1_EARLY));
    // Live survivors AFTER the cancel (the service queries post-update).
    findManyMock.mockResolvedValue([
      { id: 'a-mid', startsAt: D1_MID },
      { id: 'a-late', startsAt: D1_LATE },
      { id: 'b-d2', startsAt: D2 },
    ]);
    await cancelAppointment(cancelInput('a-early'));

    // Its own job removed first (P17), then the day's earliest survivor
    // inherits; the later same-day sibling explicitly has NO job.
    expect(cancelledIds()[0]).toBe('a-early');
    expect(enqueuedIds()).toEqual(['a-mid']);
    expect(cancelledIds()).toContain('a-late');
    // Day 2 is untouched by a day-1 cancel (not in the resync's day set).
    expect(enqueuedIds()).not.toContain('b-d2');
    expect(cancelledIds()).not.toContain('b-d2');
  });

  it('the resync only considers LIVE upcoming occurrences of THAT series', async () => {
    findUniqueMock.mockResolvedValue(apptRow('a-early', D1_EARLY));
    findManyMock.mockResolvedValue([]);
    await cancelAppointment(cancelInput('a-early'));
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          seriesId: 'ser_1',
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
          startsAt: { gt: expect.any(Date) },
        }),
      }),
    );
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('cancelling a NON-reminded sibling keeps the earliest as the (idempotently re-set) target', async () => {
    findUniqueMock.mockResolvedValue(apptRow('a-mid', D1_MID));
    findManyMock.mockResolvedValue([
      { id: 'a-early', startsAt: D1_EARLY },
      { id: 'a-late', startsAt: D1_LATE },
    ]);
    await cancelAppointment(cancelInput('a-mid'));
    expect(enqueuedIds()).toEqual(['a-early']); // replace-in-place, no duplicate job
    expect(cancelledIds()).toEqual(expect.arrayContaining(['a-mid', 'a-late']));
  });

  it('a non-series cancel never looks at siblings', async () => {
    findUniqueMock.mockResolvedValue(apptRow('solo', D1_EARLY, null));
    await cancelAppointment(cancelInput('solo'));
    expect(findManyMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(cancelledIds()).toEqual(['solo']);
  });
});

describe('reschedule — dedup re-run for the old AND new day (§3.2)', () => {
  const resched = (id: string, startsAt: Date) =>
    rescheduleAppointment({
      id,
      startsAt,
      durationMinutes: 60,
      overrideConflicts: false,
      resize: false,
    });

  it('moving the day-2 occurrence onto day 1 (later than its earliest) → it gets NO own reminder', async () => {
    findUniqueMock.mockResolvedValue(apptRow('b-d2', D2));
    // Post-move live rows: b-d2 now sits on day 1 at 15:00 local.
    findManyMock.mockResolvedValue([
      { id: 'a-early', startsAt: D1_EARLY },
      { id: 'b-d2', startsAt: D1_LATE },
    ]);
    await resched('b-d2', D1_LATE);
    expect(cancelledIds()[0]).toBe('b-d2'); // the plain P17 remove-before-re-add
    expect(enqueuedIds()).toEqual(['a-early']);
    expect(enqueuedIds()).not.toContain('b-d2');
  });

  it('moving the reminded occurrence to another day → old day passes the reminder on, new day gets one', async () => {
    findUniqueMock.mockResolvedValue(apptRow('a-early', D1_EARLY));
    findManyMock.mockResolvedValue([
      { id: 'a-mid', startsAt: D1_MID },
      { id: 'a-early', startsAt: D2 },
    ]);
    await resched('a-early', D2);
    expect(enqueuedIds().sort()).toEqual(['a-early', 'a-mid']);
  });

  it('a non-series reschedule keeps the plain per-appointment re-enqueue', async () => {
    findUniqueMock.mockResolvedValue(apptRow('solo', D1_EARLY, null));
    await resched('solo', D2);
    expect(findManyMock).not.toHaveBeenCalled();
    expect(enqueuedIds()).toEqual(['solo']);
  });
});

describe('isolation — dispatch control never enters reminder scheduling', () => {
  it('the dedup machinery reads only the reminder settings, never the dispatch modes', async () => {
    findUniqueMock.mockResolvedValue(apptRow('a-early', D1_EARLY));
    findManyMock.mockResolvedValue([{ id: 'a-mid', startsAt: D1_MID }]);
    await cancelAppointment(cancelInput('a-early'));
    for (const call of clinicSettingsMock.mock.calls as unknown as Array<[{ select: object }]>) {
      expect(Object.keys(call[0].select)).not.toEqual(
        expect.arrayContaining(['bookingDispatchMode']),
      );
    }
    expect(enqueuedIds()).toEqual(['a-mid']);
  });

  it('reminderWindow.ts (home of the pure picker) imports nothing from the dispatch layer', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'lib/appointments/reminderWindow.ts'), 'utf8');
    expect(src).not.toContain('whatsapp/dispatch');
    expect(src).not.toContain('getDispatchSettings');
  });
});
