import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Drag-reschedule service behaviour (Prompt 34 — NI-3 verification):
 *   - a multi-therapist drop is a TIME-ONLY move: all AppointmentTherapist
 *     rows untouched, conflicts re-checked for EVERY assigned therapist;
 *   - a clash for the second therapist blocks the drop;
 *   - the room is KEPT when the caller omits roomId (the calendar drag never
 *     sends one — the old `?? null` write stripped the room on every drag);
 *   - resize stays duration-only and skips the conflict check (July #6).
 */

const { checkConflictsMock, hardBlockedMock } = vi.hoisted(() => ({
  checkConflictsMock: vi.fn(),
  hardBlockedMock: vi.fn((_conflicts: unknown) => false),
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'sec-1' } })) }));
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_cfg: unknown, fn: unknown) => fn,
}));
vi.mock('@/lib/queue/jobs/appointmentReminder', () => ({
  enqueueAppointmentReminder: vi.fn(),
  cancelAppointmentReminder: vi.fn(),
}));
vi.mock('@/lib/queue/jobs/autoCompleteSession', () => ({
  enqueueAutoCompleteSession: vi.fn(),
  cancelAutoCompleteSession: vi.fn(),
}));
vi.mock('@/lib/patients/assignment', () => ({ addCareTeamMemberTx: vi.fn() }));
vi.mock('@/lib/waitlist/services', () => ({ notifyWaitlistForFreedSlot: vi.fn() }));
vi.mock('@/lib/time/clinic-server', () => ({ getClinicTimeZone: vi.fn(async () => 'Asia/Amman') }));
vi.mock('../conflicts', () => ({
  checkConflicts: (...a: unknown[]) => checkConflictsMock(...a),
  hasHardBlockedConflict: (...a: unknown[]) => hardBlockedMock(...(a as [unknown])),
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

describe('resize (July #6 — duration-only, free)', () => {
  it('skips the conflict check, keeps start/room, retains all therapists', async () => {
    const r = await rescheduleAppointment({
      id: 'a1',
      startsAt: FUTURE,
      durationMinutes: 60,
      resize: true,
      overrideConflicts: false,
    } as never);
    expect(r).toMatchObject({ resized: true });
    expect(checkConflictsMock).not.toHaveBeenCalled();
    expect(txAppointmentUpdate.mock.calls[0]![0].data).toEqual({ durationMinutes: 60 });
    expect(txTherapistDeleteMany).not.toHaveBeenCalled();
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
