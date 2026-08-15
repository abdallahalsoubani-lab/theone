import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canAddSessionReport,
  isSessionReportMissing,
  roleAuthorsSessionReports,
} from '../eligibility';

/**
 * Prompt 46 row 5 — the session report is reachable again, but only for the
 * right sessions and the right people:
 *   - states: IN_PROGRESS + COMPLETED only (the post-25b QA scenario is a
 *     COMPLETED appointment with no note),
 *   - authors: assigned therapist, any DOCTOR (new grant), ADMIN,
 *   - never: cancelled / no-show / future appointments, unassigned therapists.
 */

// withAudit passthrough — test the inner service directly.
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_cfg: unknown, fn: unknown) => fn,
}));

const authMock = vi.fn(
  async (): Promise<unknown> => ({
    user: { id: 'th-assigned', role: 'THERAPIST' },
  }),
);
vi.mock('@/auth', () => ({ auth: () => authMock() }));

const state: {
  appointment: Record<string, unknown> | null;
  existingPrimary: { id: string } | null;
  created: Array<Record<string, unknown>>;
  statusUpdates: Array<Record<string, unknown>>;
} = { appointment: null, existingPrimary: null, created: [], statusUpdates: [] };

vi.mock('@/lib/db', () => ({
  db: {
    appointment: {
      findUnique: vi.fn(async () => state.appointment),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.statusUpdates.push(args.data);
        return {};
      }),
    },
    sessionNote: {
      findFirst: vi.fn(async () => state.existingPrimary),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data);
        return { id: 'note-1' };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        sessionNote: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            state.created.push(data);
            return { id: 'note-1' };
          },
        },
        appointment: {
          update: async (args: { data: Record<string, unknown> }) => {
            state.statusUpdates.push(args.data);
            return {};
          },
        },
      };
      return fn(tx);
    }),
  },
  toLocalizedError: (e: unknown) => e,
}));

const { createSessionNote } = await import('../services');

const baseAppt = {
  id: 'appt-1',
  patientId: 'pat-1',
  therapists: [{ therapistId: 'th-assigned' }],
  status: 'COMPLETED',
};

const input = { appointmentId: 'appt-1', subjective: 's', painScore: 3 } as never;

beforeEach(() => {
  state.appointment = { ...baseAppt };
  state.existingPrimary = null;
  state.created.length = 0;
  state.statusUpdates.length = 0;
  authMock.mockResolvedValue({ user: { id: 'th-assigned', role: 'THERAPIST' } });
});

describe('createSessionNote — eligible states (server authority)', () => {
  it('assigned therapist creates for a COMPLETED appointment (the QA scenario)', async () => {
    const r = await createSessionNote(input, { therapistId: 'th-assigned' });
    expect(r.noteId).toBe('note-1');
    expect(state.created).toHaveLength(1);
  });

  it('assigned therapist creates for IN_PROGRESS (and it transitions to COMPLETED)', async () => {
    state.appointment = { ...baseAppt, status: 'IN_PROGRESS' };
    await createSessionNote(input, { therapistId: 'th-assigned' });
    expect(state.statusUpdates.some((u) => u.status === 'COMPLETED')).toBe(true);
  });

  for (const status of ['SCHEDULED', 'CONFIRMED', 'CANCELLED', 'NO_SHOW']) {
    it(`rejects a ${status} appointment with SESSION_NOTE_APPOINTMENT_NOT_ELIGIBLE`, async () => {
      state.appointment = { ...baseAppt, status };
      await expect(createSessionNote(input, { therapistId: 'th-assigned' })).rejects.toMatchObject({
        error: { code: 'SESSION_NOTE_APPOINTMENT_NOT_ELIGIBLE' },
      });
      expect(state.created).toHaveLength(0);
    });
  }
});

describe('createSessionNote — who may author', () => {
  it('any DOCTOR may create the shared note (Prompt 46 grant)', async () => {
    authMock.mockResolvedValue({ user: { id: 'dr-1', role: 'DOCTOR' } });
    const r = await createSessionNote(input, { therapistId: 'dr-1' });
    expect(r.noteId).toBe('note-1');
    expect(state.created[0]?.therapistId).toBe('dr-1'); // author attribution
  });

  it('an UNASSIGNED therapist stays denied (Prompt 20 rule unchanged)', async () => {
    authMock.mockResolvedValue({ user: { id: 'th-other', role: 'THERAPIST' } });
    await expect(createSessionNote(input, { therapistId: 'th-other' })).rejects.toMatchObject({
      error: { code: 'SESSION_NOTE_FORBIDDEN' },
    });
  });

  it('a second primary note is still rejected (one shared note per appointment)', async () => {
    state.existingPrimary = { id: 'note-existing' };
    await expect(createSessionNote(input, { therapistId: 'th-assigned' })).rejects.toMatchObject({
      error: { code: 'SESSION_NOTE_EXISTS' },
    });
  });
});

describe('eligibility helpers (shared by every entry-point surface)', () => {
  it('canAddSessionReport: IN_PROGRESS + COMPLETED only', () => {
    expect(canAddSessionReport('IN_PROGRESS')).toBe(true);
    expect(canAddSessionReport('COMPLETED')).toBe(true);
    expect(canAddSessionReport('SCHEDULED')).toBe(false);
    expect(canAddSessionReport('CONFIRMED')).toBe(false);
    expect(canAddSessionReport('CANCELLED')).toBe(false);
    expect(canAddSessionReport('NO_SHOW')).toBe(false);
  });

  it('roleAuthorsSessionReports: therapist + doctor + admin', () => {
    expect(roleAuthorsSessionReports('THERAPIST')).toBe(true);
    expect(roleAuthorsSessionReports('DOCTOR')).toBe(true);
    expect(roleAuthorsSessionReports('ADMIN')).toBe(true);
    expect(roleAuthorsSessionReports('SECRETARY')).toBe(false);
    expect(roleAuthorsSessionReports('PATIENT')).toBe(false);
  });

  it('note-missing flag: COMPLETED without a note, clears once one exists', () => {
    expect(isSessionReportMissing('COMPLETED', false)).toBe(true);
    expect(isSessionReportMissing('COMPLETED', true)).toBe(false);
    expect(isSessionReportMissing('IN_PROGRESS', false)).toBe(false);
    expect(isSessionReportMissing('CANCELLED', false)).toBe(false);
  });
});
