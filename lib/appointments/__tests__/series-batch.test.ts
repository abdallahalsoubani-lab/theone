import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * July 31 item 4 — the batch creation service. Pins the contract the modal
 * relies on:
 *   - a valid N-row batch creates exactly N appointments sharing ONE seriesId,
 *     with per-row therapists/room/duration and the standard side-effects
 *     (audit row, care-team add for every row's therapists, reminder +
 *     auto-complete jobs per appointment, ONE P53 confirmation for the
 *     nearest row);
 *   - ANY conflicting row aborts the whole batch atomically (no partial
 *     commit, no override path) with the failing row index in the details —
 *     closed days ride this same path (engine hard-block);
 *   - a past row is rejected up front;
 *   - the conflict engine receives the ROOM per row (the old pattern series
 *     never passed it — latent gap fixed by the rework).
 */

const {
  checkConflictsMock,
  createdRows,
  careTeamMock,
  reminderMock,
  autoCompleteMock,
  lifecycleMock,
  auditRows,
} = vi.hoisted(() => ({
  checkConflictsMock: vi.fn(async () => ({ ok: true }) as unknown),
  createdRows: [] as Array<Record<string, unknown>>,
  careTeamMock: vi.fn(async () => undefined),
  reminderMock: vi.fn(async () => undefined),
  autoCompleteMock: vi.fn(async () => undefined),
  lifecycleMock: vi.fn(async () => undefined),
  auditRows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'sec-1', role: 'SECRETARY' } })),
}));
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => ({ user: { id: 'sec-1' }, isImpersonating: false })),
}));
vi.mock('../conflicts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, checkConflicts: checkConflictsMock };
});
vi.mock('@/lib/patients/assignment', () => ({ addCareTeamMemberTx: careTeamMock }));
vi.mock('@/lib/queue/jobs/appointmentReminder', () => ({
  enqueueAppointmentReminder: reminderMock,
  scheduleLifecycleMessage: lifecycleMock,
  cancelAppointmentReminder: vi.fn(async () => undefined),
  cancelLifecycleMessages: vi.fn(async () => undefined),
}));
vi.mock('@/lib/queue/jobs/autoCompleteSession', () => ({
  enqueueAutoCompleteSession: autoCompleteMock,
  cancelAutoCompleteSession: vi.fn(async () => undefined),
}));
vi.mock('@/lib/waitlist/services', () => ({ notifyWaitlistForFreedSlot: vi.fn(async () => {}) }));
vi.mock('@/lib/time/clinic-server', () => ({ getClinicTimeZone: vi.fn(async () => 'Asia/Amman') }));

vi.mock('@/lib/db', () => {
  let idSeq = 0;
  const tx = {
    appointment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdRows.push(data);
        return { id: `appt-${++idSeq}` };
      }),
    },
  };
  return {
    db: {
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      clinicSettings: {
        findUnique: vi.fn(async () => ({
          defaultReminderOffsetMinutes: 1440,
          reminderWindowStart: '08:00',
          reminderWindowEnd: '18:00',
          timezone: 'Asia/Amman',
          bookingConfirmationDelayMinutes: 0,
          rescheduleMessageDelayMinutes: 0,
        })),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          auditRows.push(data);
          return data;
        }),
      },
    },
    toLocalizedError: (e: unknown) => ({ code: 'X', message_en: String(e), message_ar: '' }),
  };
});

import { AppointmentError, createSeriesBatch, previewSeriesBatch } from '../services';

const future = (h: number, extraDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7 + extraDays);
  d.setUTCHours(h, 0, 0, 0);
  return d;
};

const threeRows = () => [
  { startsAt: future(8), durationMinutes: 60, therapistIds: ['t1'], roomId: 'r1' },
  { startsAt: future(13), durationMinutes: 45, therapistIds: ['t2', 't3'], roomId: 'r2' },
  { startsAt: future(8, 2), durationMinutes: 30, therapistIds: ['t1'], roomId: 'r1' },
];

beforeEach(() => {
  vi.clearAllMocks();
  checkConflictsMock.mockResolvedValue({ ok: true });
  createdRows.length = 0;
  auditRows.length = 0;
});

describe('createSeriesBatch — happy path', () => {
  it('creates all rows with ONE shared seriesId, per-row fields, and every side-effect', async () => {
    const res = await createSeriesBatch({ patientId: 'p1', notes: null, rows: threeRows() });
    expect(res.appointmentIds).toHaveLength(3);
    expect(res.seriesId).toMatch(/^ser_sec-1_/);

    // Per-row fields landed as given; every insert carries the SAME seriesId.
    expect(createdRows).toHaveLength(3);
    expect(new Set(createdRows.map((r) => r.seriesId)).size).toBe(1);
    expect(createdRows.map((r) => r.roomId)).toEqual(['r1', 'r2', 'r1']);
    expect(createdRows.map((r) => r.durationMinutes)).toEqual([60, 45, 30]);

    // The engine saw the ROOM + SESSION type for every row (latent gap fixed).
    for (const call of checkConflictsMock.mock.calls as unknown as Array<
      [{ roomId?: string; appointmentType?: string }]
    >) {
      expect(call[0].roomId).toBeTruthy();
      expect(call[0].appointmentType).toBe('SESSION');
    }

    // Care team: every therapist appearing in any row, once each.
    const careTherapists = (careTeamMock.mock.calls as unknown as Array<unknown[]>).map(
      (c) => c[2],
    );
    expect(new Set(careTherapists)).toEqual(new Set(['t1', 't2', 't3']));

    // Reminder + auto-complete per appointment; ONE P53 confirmation.
    expect(reminderMock).toHaveBeenCalledTimes(3);
    expect(autoCompleteMock).toHaveBeenCalledTimes(3);
    expect(lifecycleMock).toHaveBeenCalledTimes(1);

    // One audit row for the series create.
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ entityType: 'Appointment', actorId: 'sec-1' });
  });
});

describe('createSeriesBatch — conflicts abort atomically (FR-APP-8 replacement)', () => {
  it('a conflicting row blocks the WHOLE batch with the row index; nothing else created', async () => {
    checkConflictsMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        conflicts: [{ kind: 'THERAPIST_OVERLAP' }],
      })
      .mockResolvedValue({ ok: true });
    const err = await createSeriesBatch({ patientId: 'p1', notes: null, rows: threeRows() }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppointmentError);
    expect((err as AppointmentError).error.code).toBe('SERIES_ROW_CONFLICT');
    expect((err as AppointmentError).error.details?.rowIndex).toBe(1);
    // No side-effects fired; no audit row (we only audit committed state).
    expect(reminderMock).not.toHaveBeenCalled();
    expect(lifecycleMock).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(0);
  });

  it('closed days ride the same path — an engine hard-block aborts the batch', async () => {
    checkConflictsMock.mockResolvedValueOnce({
      ok: false,
      conflicts: [{ kind: 'CLINIC_CLOSED_THIS_DAY', dayKey: 'fri' }],
    });
    const err = await createSeriesBatch({ patientId: 'p1', notes: null, rows: threeRows() }).catch(
      (e: unknown) => e,
    );
    expect((err as AppointmentError).error.code).toBe('SERIES_ROW_CONFLICT');
    expect((err as AppointmentError).error.details?.rowIndex).toBe(0);
  });

  it('a past row is rejected up front, naming the row', async () => {
    const rows = threeRows();
    rows[2] = { ...rows[2]!, startsAt: new Date('2020-01-01T10:00:00Z') };
    const err = await createSeriesBatch({ patientId: 'p1', notes: null, rows }).catch(
      (e: unknown) => e,
    );
    expect((err as AppointmentError).error.code).toBe('SERIES_ROW_IN_PAST');
    expect((err as AppointmentError).error.details?.rowIndex).toBe(2);
    expect(checkConflictsMock).not.toHaveBeenCalled();
  });
});

describe('previewSeriesBatch — submit-time sweep', () => {
  it('returns per-row conflict results (room included) without writing anything', async () => {
    checkConflictsMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, conflicts: [{ kind: 'ROOM_AT_CAPACITY' }] })
      .mockResolvedValueOnce({ ok: true });
    const res = await previewSeriesBatch({ patientId: 'p1', notes: null, rows: threeRows() });
    expect(res.rows.map((r) => r.conflicts.ok)).toEqual([true, false, true]);
    expect(createdRows).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });
});
