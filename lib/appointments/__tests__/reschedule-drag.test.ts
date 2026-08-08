import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Drag-reschedule service behaviour (Prompt 34 — NI-3 verification):
 *   - a multi-therapist drop is a TIME-ONLY move: all AppointmentTherapist
 *     rows untouched, conflicts re-checked for EVERY assigned therapist;
 *   - a clash for the second therapist blocks the drop;
 *   - the room is KEPT when the caller omits roomId (the calendar drag never
 *     sends one — the old `?? null` write stripped the room on every drag);
 *   - resize stays duration-only and free of every SOFT conflict (July #6),
 *     but same-patient overlap blocks it like every other path (PT-B1 item 3).
 */

const { checkConflictsMock, hardBlockedMock, samePatientMock } = vi.hoisted(() => ({
  checkConflictsMock: vi.fn(),
  hardBlockedMock: vi.fn((_conflicts: unknown) => false),
  samePatientMock: vi.fn((_conflicts: unknown) => false),
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'sec-1' } })) }));
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_cfg: unknown, fn: unknown) => fn,
}));
vi.mock('@/lib/queue/jobs/appointmentReminder', () => ({
  enqueueAppointmentReminder: vi.fn(),
  cancelAppointmentReminder: vi.fn(),
  scheduleLifecycleMessage: vi.fn(async () => null),
  cancelLifecycleMessages: vi.fn(async () => ({ confirmWasPending: false })),
}));
vi.mock('@/lib/queue/jobs/autoCompleteSession', () => ({
  enqueueAutoCompleteSession: vi.fn(),
  cancelAutoCompleteSession: vi.fn(),
}));
vi.mock('@/lib/patients/assignment', () => ({ addCareTeamMemberTx: vi.fn() }));
// Prompt 48 — the reschedule message: assert fire/silence per path.
// P53: the send is now DEFERRED — the service schedules a lifecycle job
// instead of calling the sender directly; kind depends on whether the
// confirmation ever actually went out (mocked "yes" here → 'reschedule').
vi.mock('@/lib/whatsapp/templates/sendRescheduled', () => ({
  sendAppointmentRescheduled: vi.fn(async () => undefined),
}));
vi.mock('@/lib/whatsapp/templates/sendConfirmation', () => ({
  confirmationAlreadySent: vi.fn(async () => true),
  sendAppointmentConfirmation: vi.fn(async () => undefined),
}));
vi.mock('@/lib/waitlist/services', () => ({ notifyWaitlistForFreedSlot: vi.fn() }));
vi.mock('@/lib/time/clinic-server', () => ({ getClinicTimeZone: vi.fn(async () => 'Asia/Amman') }));
vi.mock('../conflicts', () => ({
  checkConflicts: (...a: unknown[]) => checkConflictsMock(...a),
  hasHardBlockedConflict: (...a: unknown[]) => hardBlockedMock(...(a as [unknown])),
  hasSamePatientOverlap: (...a: unknown[]) => samePatientMock(...(a as [unknown])),
}));

const { txAppointmentUpdate, txTherapistFindMany, txTherapistDeleteMany, txTherapistCreate } =
  vi.hoisted(() => ({
    txAppointmentUpdate: vi.fn(),
    txTherapistFindMany: vi.fn(async () => [{ therapistId: 't1' }, { therapistId: 't2' }]),
    txTherapistDeleteMany: vi.fn(),
    txTherapistCreate: vi.fn(),
  }));

vi.mock('@/lib/db', () => {
  const tx = {
    appointment: { update: txAppointmentUpdate },
    appointmentTherapist: {
      findMany: txTherapistFindMany,
      deleteMany: txTherapistDeleteMany,
      create: txTherapistCreate,
    },
  };
  return {
    db: {
      appointment: {
        findUnique: vi.fn(async () => ({
          id: 'a1',
          patientId: 'p1',
          status: 'SCHEDULED',
          appointmentType: 'SESSION',
          roomId: 'room-1',
          groupPatients: [],
          // Prompt 48: the reschedule-message guard compares old vs new start.
          startsAt: new Date('2030-01-07T08:00:00Z'),
        })),
      },
      appointmentTherapist: {
        findMany: vi.fn(async () => [{ therapistId: 't1' }, { therapistId: 't2' }]),
      },
      clinicSettings: {
        findUnique: vi.fn(async () => ({
          defaultReminderOffsetMinutes: 1440,
          reminderWindowStart: '08:00',
          reminderWindowEnd: '18:00',
          timezone: 'Asia/Amman',
        })),
      },
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    },
    toLocalizedError: (e: unknown) => e,
  };
});

import { AppointmentError, rescheduleAppointment } from '../services';

const FUTURE = new Date('2030-01-05T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  checkConflictsMock.mockResolvedValue({ ok: true, conflicts: [] });
  hardBlockedMock.mockReturnValue(false);
  samePatientMock.mockReturnValue(false);
});

describe('multi-therapist drag (time-only move)', () => {
  it('re-checks conflicts for EVERY assigned therapist and keeps all rows + the room', async () => {
    const r = await rescheduleAppointment({
      id: 'a1',
      startsAt: FUTURE,
      durationMinutes: 45,
      overrideConflicts: false,
    } as never);
    expect(r).toMatchObject({ appointmentId: 'a1', conflictsOverridden: false });

    // Conflict engine saw the FULL therapist set, not just one lane.
    expect(checkConflictsMock).toHaveBeenCalledWith(
      expect.objectContaining({ therapistIds: ['t1', 't2'], roomId: 'room-1' }),
    );
    // Time-only move: therapist rows untouched.
    expect(txTherapistDeleteMany).not.toHaveBeenCalled();
    expect(txTherapistCreate).not.toHaveBeenCalled();
    // Room preserved: the update payload must NOT touch roomId at all.
    const data = txAppointmentUpdate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ startsAt: FUTURE, durationMinutes: 45 });
    expect('roomId' in data).toBe(false);
  });

  it('a clash for the SECOND therapist blocks the drop and surfaces that therapist', async () => {
    checkConflictsMock.mockResolvedValue({
      ok: false,
      conflicts: [
        {
          kind: 'THERAPIST_OVERLAP',
          therapist: { id: 't2', fullNameEn: 'Layan Haddad', fullNameAr: 'ليان حداد' },
          appointment: {},
        },
      ],
    });
    await expect(
      rescheduleAppointment({
        id: 'a1',
        startsAt: FUTURE,
        durationMinutes: 45,
        overrideConflicts: false,
      } as never),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(AppointmentError);
      const conflicts = (e as AppointmentError).error.details?.conflicts as Array<{
        therapist?: { fullNameEn: string };
      }>;
      expect(conflicts?.[0]?.therapist?.fullNameEn).toBe('Layan Haddad');
      return true;
    });
    expect(txAppointmentUpdate).not.toHaveBeenCalled();
  });
});

describe('single-therapist lane change (explicit therapistIds)', () => {
  it('replaces the therapist set only when the caller sends one', async () => {
    txTherapistFindMany.mockResolvedValueOnce([{ therapistId: 't1' }]);
    await rescheduleAppointment({
      id: 'a1',
      startsAt: FUTURE,
      durationMinutes: 30,
      therapistIds: ['t9'],
      overrideConflicts: false,
    } as never);
    expect(checkConflictsMock).toHaveBeenCalledWith(
      expect.objectContaining({ therapistIds: ['t9'] }),
    );
    expect(txTherapistCreate).toHaveBeenCalledWith({
      data: { appointmentId: 'a1', therapistId: 't9' },
    });
  });
});

describe('resize — duration-only, full conflict engine (PT-B2 §5.2)', () => {
  it('keeps start/room and retains all therapists', async () => {
    const r = await rescheduleAppointment({
      id: 'a1',
      startsAt: FUTURE,
      durationMinutes: 60,
      resize: true,
      overrideConflicts: false,
    } as never);
    expect(r).toMatchObject({ resized: true });
    expect(txAppointmentUpdate.mock.calls[0]![0].data).toEqual({ durationMinutes: 60 });
    expect(txTherapistDeleteMany).not.toHaveBeenCalled();
  });

  it('is blocked by a therapist overlap, exactly like a drag (free resize withdrawn)', async () => {
    // PT-B2 §5.2 owner ruling: stretching an appointment over a colleague's
    // slot, a leave, or a held room double-books just as a move would, so the
    // resize path is no longer exempt from the soft-conflict block either.
    checkConflictsMock.mockResolvedValue({
      ok: false,
      conflicts: [
        {
          kind: 'THERAPIST_OVERLAP',
          therapist: { id: 't2', fullNameEn: 'Layan Haddad', fullNameAr: 'ليان حداد' },
          appointment: {},
        },
      ],
    });

    await expect(
      rescheduleAppointment({
        id: 'a1',
        startsAt: FUTURE,
        durationMinutes: 60,
        resize: true,
        overrideConflicts: false,
      } as never),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(AppointmentError);
      // Same error the drag path raises — same message, same shape.
      expect((e as AppointmentError).error.code).toBe('APPOINTMENT_CONFLICT');
      return true;
    });
    expect(txAppointmentUpdate).not.toHaveBeenCalled();
  });

  it('a soft conflict can still be overridden by a user who holds the permission', async () => {
    checkConflictsMock.mockResolvedValue({
      ok: false,
      conflicts: [
        {
          kind: 'THERAPIST_OVERLAP',
          therapist: { id: 't2', fullNameEn: 'Layan Haddad', fullNameAr: 'ليان حداد' },
          appointment: {},
        },
      ],
    });

    const r = await rescheduleAppointment({
      id: 'a1',
      startsAt: FUTURE,
      durationMinutes: 60,
      resize: true,
      overrideConflicts: true,
    } as never);
    expect(r).toMatchObject({ resized: true, conflictsOverridden: true });
  });

  it('is BLOCKED when the longer session swallows the same patient’s next booking', async () => {
    // PT-B1 item 3: same-patient overlap is absolute on every path, and a
    // resize is the one that used to skip the engine entirely.
    checkConflictsMock.mockResolvedValue({
      ok: false,
      conflicts: [
        {
          kind: 'PATIENT_OVERLAP',
          appointment: { id: 'a2', startsAt: new Date('2030-01-05T11:00:00Z') },
        },
      ],
    });
    // Same-patient overlap is a hard-blocked kind.
    hardBlockedMock.mockReturnValue(true);

    await expect(
      rescheduleAppointment({
        id: 'a1',
        startsAt: FUTURE,
        durationMinutes: 180,
        resize: true,
        overrideConflicts: false,
      } as never),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(AppointmentError);
      expect((e as AppointmentError).error.code).toBe('APPOINTMENT_SAME_PATIENT_OVERLAP');
      return true;
    });
    expect(txAppointmentUpdate).not.toHaveBeenCalled();
  });

  it('cannot be forced through with the override flag either', async () => {
    checkConflictsMock.mockResolvedValue({
      ok: false,
      conflicts: [{ kind: 'PATIENT_OVERLAP', appointment: { id: 'a2' } }],
    });
    hardBlockedMock.mockReturnValue(true);

    await expect(
      rescheduleAppointment({
        id: 'a1',
        startsAt: FUTURE,
        durationMinutes: 180,
        resize: true,
        overrideConflicts: true,
      } as never),
    ).rejects.toBeInstanceOf(AppointmentError);
    expect(txAppointmentUpdate).not.toHaveBeenCalled();
  });
});

describe('dragReassignTherapistIds (cross-column rule — Prompt 20 #2 / Prompt 34)', () => {
  it('single-therapist appointment dropped in another lane → reassign to that lane', async () => {
    const { dragReassignTherapistIds } = await import('../drag');
    expect(dragReassignTherapistIds(['t1'], 't2')).toEqual(['t2']);
  });

  it('single-therapist appointment dropped in its OWN lane → keep (undefined)', async () => {
    const { dragReassignTherapistIds } = await import('../drag');
    expect(dragReassignTherapistIds(['t1'], 't1')).toBeUndefined();
    expect(dragReassignTherapistIds(['t1'], undefined)).toBeUndefined();
  });

  it('MULTI-therapist session → time-only regardless of the drop lane (no swap/drop)', async () => {
    const { dragReassignTherapistIds } = await import('../drag');
    expect(dragReassignTherapistIds(['t1', 't2'], 't3')).toBeUndefined();
    expect(dragReassignTherapistIds(['t1', 't2'], 't1')).toBeUndefined();
  });
});

describe('reschedule message firing (Prompt 48 — owner ruling)', () => {
  it('schedules ONE deferred reschedule job when the start actually moves (P53)', async () => {
    const { scheduleLifecycleMessage } = await import('@/lib/queue/jobs/appointmentReminder');
    vi.mocked(scheduleLifecycleMessage).mockClear();
    await rescheduleAppointment({
      id: 'a1',
      startsAt: FUTURE, // differs from the stored 2030-01-07T08:00Z
      durationMinutes: 30,
      overrideConflicts: false,
    } as never);
    expect(scheduleLifecycleMessage).toHaveBeenCalledTimes(1);
    expect(scheduleLifecycleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'a1', kind: 'reschedule' }),
    );
  });

  it('does NOT fire on a duration-only resize (silent by ruling)', async () => {
    const { scheduleLifecycleMessage } = await import('@/lib/queue/jobs/appointmentReminder');
    vi.mocked(scheduleLifecycleMessage).mockClear();
    await rescheduleAppointment({
      id: 'a1',
      startsAt: FUTURE,
      durationMinutes: 60,
      resize: true,
      overrideConflicts: false,
    } as never);
    expect(scheduleLifecycleMessage).not.toHaveBeenCalled();
  });

  it('does NOT fire on a same-slot save (start unchanged)', async () => {
    const { scheduleLifecycleMessage } = await import('@/lib/queue/jobs/appointmentReminder');
    vi.mocked(scheduleLifecycleMessage).mockClear();
    await rescheduleAppointment({
      id: 'a1',
      startsAt: new Date('2030-01-07T08:00:00Z'), // equals the stored start
      durationMinutes: 45, // duration change without the resize flag
      overrideConflicts: false,
    } as never);
    expect(scheduleLifecycleMessage).not.toHaveBeenCalled();
  });
});
