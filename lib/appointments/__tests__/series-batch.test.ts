import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * July 31 item 4 — the batch creation service. Pins the contract the modal
 * relies on:
 *   - a valid N-row batch creates exactly N appointments sharing ONE seriesId,
 *     with per-row therapists/room/duration and the standard side-effects
 *     (audit row, care-team add for every row's therapists, one reminder
 *     job per clinic-local DAY — same-day rows share the earliest one, P50
 *     §3.2 — no auto-complete, ONE P53 confirmation for the nearest row);
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
const dispatchMock = vi.hoisted(() =>
  vi.fn(async () => ({ entryId: 'd1', suppressed: null, confirmWasPending: false })),
);
vi.mock('@/lib/whatsapp/dispatch/service', () => ({
  recordDispatchEvent: dispatchMock,
}));
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

const SESSION = 'SESSION' as const;
const STRETCHING = 'STRETCHING' as const;

const future = (h: number, extraDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7 + extraDays);
  d.setUTCHours(h, 0, 0, 0);
  return d;
};

const threeRows = () => [
  {
    startsAt: future(8),
    durationMinutes: 60,
    therapistIds: ['t1'],
    roomId: 'r1',
    appointmentType: SESSION,
  },
  {
    startsAt: future(13),
    durationMinutes: 45,
    therapistIds: ['t2', 't3'],
    roomId: 'r2',
    appointmentType: SESSION,
  },
  {
    startsAt: future(8, 2),
    durationMinutes: 30,
    therapistIds: ['t1'],
    roomId: 'r1',
    appointmentType: SESSION,
  },
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

    // Reminder per clinic DAY (rows 0+1 share day+7 → one job, P50 §3.2;
    // row 2 is day+9); ONE P53 confirmation. No auto-complete job —
    // sessions are closed by a human (PT-B3 item 1).
    expect(reminderMock).toHaveBeenCalledTimes(2);
    expect(autoCompleteMock).not.toHaveBeenCalled();
    expect(dispatchMock).toHaveBeenCalledTimes(1);

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
    expect(dispatchMock).not.toHaveBeenCalled();
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

describe('createSeriesBatch — WhatsApp policy (Amendment 46.1: confirm first only, remind all)', () => {
  it('rows entered OUT OF ORDER → the one confirmation targets the EARLIEST appointment', async () => {
    // Row 0 is the LATEST date; the earliest is row 1.
    const rows = [
      {
        startsAt: future(8, 9),
        durationMinutes: 60,
        therapistIds: ['t1'],
        roomId: 'r1',
        appointmentType: SESSION,
      },
      {
        startsAt: future(8),
        durationMinutes: 60,
        therapistIds: ['t1'],
        roomId: 'r1',
        appointmentType: SESSION,
      },
      {
        startsAt: future(8, 4),
        durationMinutes: 60,
        therapistIds: ['t1'],
        roomId: 'r1',
        appointmentType: SESSION,
      },
    ];
    const res = await createSeriesBatch({ patientId: 'p1', notes: null, rows });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: res.appointmentIds[1],
        startsAt: rows[1]!.startsAt,
        type: 'BOOKING_CONFIRMATION',
      }),
    );
  });

  it('every DAY gets its own reminder job (remind all days), and none is auto-completed', async () => {
    // threeRows(): day+7 08:00Z, day+7 13:00Z (same clinic day), day+9 08:00Z.
    // P50 §3.2: the two same-day rows share ONE reminder — the earlier one.
    const res = await createSeriesBatch({ patientId: 'p1', notes: null, rows: threeRows() });
    const reminderIds = (reminderMock.mock.calls as unknown as Array<[{ appointmentId: string }]>)
      .map((c) => c[0].appointmentId)
      .sort();
    expect(reminderIds).toEqual([res.appointmentIds[0], res.appointmentIds[2]].sort());
    // PT-B3 item 1 — nothing schedules a session to close itself.
    expect(autoCompleteMock).not.toHaveBeenCalled();
  });

  it('P50 §3: an 8-row mixed series → ONE confirmation (either mode) + one reminder PER DAY', async () => {
    // 3 on day A (back-to-back), 2 on day B, 1 each on days C/D/E = 8 rows, 5 days.
    const row = (h: number, d: number) => ({
      startsAt: future(h, d),
      durationMinutes: 60,
      therapistIds: ['t1'],
      roomId: 'r1',
      appointmentType: SESSION,
    });
    const rows = [
      row(12, 0),
      row(9, 0),
      row(10, 0), // day A — 9:00Z is the earliest
      row(14, 1),
      row(8, 1), //             day B — 8:00Z earliest
      row(8, 3),
      row(8, 5),
      row(8, 6), //   days C/D/E
    ];
    const res = await createSeriesBatch({ patientId: 'p1', notes: null, rows });
    expect(res.appointmentIds).toHaveLength(8);
    // ONE confirmation, anchored to the earliest row (index 1) — the funnel
    // decides AUTO (one send) vs MANUAL (one outbox row); either way ONE.
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: res.appointmentIds[1],
        type: 'BOOKING_CONFIRMATION',
      }),
    );
    // Reminders: earliest of A (idx 1), earliest of B (idx 4), then C/D/E.
    const reminderIds = (reminderMock.mock.calls as unknown as Array<[{ appointmentId: string }]>)
      .map((c) => c[0].appointmentId)
      .sort();
    const expected = [1, 4, 5, 6, 7].map((i) => res.appointmentIds[i]!).sort();
    expect(reminderIds).toEqual(expected);
  });

  it('a SINGLE-row batch is unchanged: one confirmation, one reminder', async () => {
    const res = await createSeriesBatch({ patientId: 'p1', notes: null, rows: [threeRows()[0]!] });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(reminderMock).toHaveBeenCalledTimes(1);
    expect(reminderMock).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: res.appointmentIds[0] }),
    );
  });

  it('a confirmation scheduling failure never fails the committed batch', async () => {
    dispatchMock.mockRejectedValueOnce(new Error('redis down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await createSeriesBatch({ patientId: 'p1', notes: null, rows: threeRows() });
    expect(res.appointmentIds).toHaveLength(3);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('createSeriesBatch — per-row booking type (Prompt 51)', () => {
  const mixedRows = () => [
    // Row A — SESSION with two therapists.
    {
      startsAt: future(8),
      durationMinutes: 60,
      therapistIds: ['t1', 't2'],
      roomId: 'r1',
      appointmentType: SESSION,
    },
    // Row B — STRETCHING: room only, zero therapists (next day).
    {
      startsAt: future(8, 1),
      durationMinutes: 30,
      therapistIds: [],
      roomId: 'r2',
      appointmentType: STRETCHING,
    },
    // Row C — SESSION again, same therapist as A (care-team dedup).
    {
      startsAt: future(8, 3),
      durationMinutes: 60,
      therapistIds: ['t1'],
      roomId: 'r1',
      appointmentType: SESSION,
    },
  ];

  it('a mixed batch creates every row with ITS OWN appointmentType', async () => {
    const res = await createSeriesBatch({ patientId: 'p1', notes: null, rows: mixedRows() });
    expect(res.appointmentIds).toHaveLength(3);
    expect(createdRows.map((r) => r.appointmentType)).toEqual([SESSION, STRETCHING, SESSION]);
    // STRETCHING row: no therapist join rows; SESSION rows keep theirs.
    const joins = createdRows.map(
      (r) => (r.therapists as { create: { therapistId: string }[] }).create.length,
    );
    expect(joins).toEqual([2, 0, 1]);
  });

  it('each row is conflict-checked by ITS OWN type (STRETCHING → capacity branch input)', async () => {
    await createSeriesBatch({ patientId: 'p1', notes: null, rows: mixedRows() });
    const calls = checkConflictsMock.mock.calls as unknown as Array<
      [{ appointmentType: string; therapistIds: string[]; roomId: string }]
    >;
    expect(calls.map((c) => c[0].appointmentType)).toEqual([SESSION, STRETCHING, SESSION]);
    expect(calls[1]![0].therapistIds).toEqual([]);
    expect(calls[1]![0].roomId).toBe('r2');
  });

  it('a STRETCHING row over bed capacity blocks the WHOLE batch (engine verdict honoured per row)', async () => {
    checkConflictsMock.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      ok: false,
      conflicts: [{ type: 'ROOM_CAPACITY_EXCEEDED', severity: 'HARD' }],
    });
    const err = await createSeriesBatch({ patientId: 'p1', notes: null, rows: mixedRows() }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppointmentError);
    expect((err as AppointmentError).error.code).toBe('SERIES_ROW_CONFLICT');
    expect((err as AppointmentError).error.details?.rowIndex).toBe(1);
    expect(auditRows).toHaveLength(0);
  });

  it('a SESSION row clashing with a busy therapist blocks the batch too', async () => {
    checkConflictsMock.mockResolvedValueOnce({
      ok: false,
      conflicts: [{ type: 'THERAPIST_OVERLAP', severity: 'HARD' }],
    });
    const err = await createSeriesBatch({ patientId: 'p1', notes: null, rows: mixedRows() }).catch(
      (e: unknown) => e,
    );
    expect((err as AppointmentError).error.details?.rowIndex).toBe(0);
  });

  it('care team: SESSION therapists added once each; the STRETCHING row adds nobody', async () => {
    await createSeriesBatch({ patientId: 'p1', notes: null, rows: mixedRows() });
    const added = (careTeamMock.mock.calls as unknown as Array<[unknown, string, string]>)
      .map((c) => c[2])
      .sort();
    expect(added).toEqual(['t1', 't2']); // t1 appears in two rows → once
  });

  it('Prompt 50 messaging holds for a mixed series: ONE confirmation (earliest row) + one reminder per day', async () => {
    const res = await createSeriesBatch({ patientId: 'p1', notes: null, rows: mixedRows() });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: res.appointmentIds[0],
        type: 'BOOKING_CONFIRMATION',
      }),
    );
    // Three distinct days → three reminders, the STRETCHING row included
    // (it is patient-bound like any other row).
    expect(reminderMock).toHaveBeenCalledTimes(3);
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
