import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 16 — home-program approval state machine + the data-layer guarantee
 * that the patient (and reminder worker) only ever see APPROVED content.
 */

const sessionRef: { current: { user: { id: string; role: string } } | null } = { current: null };
vi.mock('@/auth', () => ({ auth: vi.fn(async () => sessionRef.current) }));
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () =>
    sessionRef.current ? { isImpersonating: false, user: sessionRef.current.user } : null,
  ),
}));
vi.mock('@/lib/notifications/actions', () => ({
  createNotification: vi.fn(async () => ({ id: 'n' })),
}));
vi.mock('@/lib/patients/assignment', () => ({
  getCareTeam: vi.fn(async () => ({
    doctors: [{ id: 'doctor-1', fullNameEn: 'D', fullNameAr: 'D' }],
    therapists: [],
  })),
}));

vi.mock('@/lib/db', () => {
  interface Item {
    id: string;
    patientId: string;
    exerciseId: string;
    daysOfWeek: number[];
    scheduledTime: string;
    durationMinutes: number;
    setsReps: string | null;
    therapistNote: string | null;
    active: boolean;
    reminderJobKey: string | null;
    createdAt: Date;
    exercise: Record<string, unknown>;
  }
  const state = {
    approvals: new Map<string, Record<string, unknown>>(),
    items: [] as Item[],
    auditLogs: [] as Array<Record<string, unknown>>,
  };
  return {
    __state: state,
    db: {
      homeProgramApproval: {
        findUnique: vi.fn(
          async ({ where }: { where: { patientId: string } }) =>
            state.approvals.get(where.patientId) ?? null,
        ),
        upsert: vi.fn(
          async ({
            where,
            update,
            create,
          }: {
            where: { patientId: string };
            update: Record<string, unknown>;
            create: Record<string, unknown>;
          }) => {
            const existing = state.approvals.get(where.patientId);
            // Mimic the schema default remindersEnabled @default(true) on create.
            const next = existing
              ? { ...existing, ...update }
              : { remindersEnabled: true, ...create };
            state.approvals.set(where.patientId, next);
            return next;
          },
        ),
        update: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { patientId: string };
            data: Record<string, unknown>;
          }) => {
            const existing = state.approvals.get(where.patientId) ?? { patientId: where.patientId };
            const next = { ...existing, ...data };
            state.approvals.set(where.patientId, next);
            return next;
          },
        ),
      },
      homeProgramItem: {
        findMany: vi.fn(async ({ where }: { where: { patientId: string } }) =>
          state.items.filter((i) => i.patientId === where.patientId),
        ),
      },
      user: {
        findUnique: vi.fn(async () => ({ fullNameEn: 'Name' })),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.auditLogs.push(data);
          return data;
        }),
      },
    },
  };
});

import {
  approveHomeProgram,
  getVisibleHomeProgram,
  onHomeProgramEdited,
  requestHomeProgramChanges,
  submitHomeProgram,
} from '../approval';
import { programApproved, remindersActive } from '../visibility';
import { setHomeProgramReminders } from '../approval';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    approvals: Map<string, Record<string, unknown>>;
    items: Array<Record<string, unknown>>;
    auditLogs: Array<Record<string, unknown>>;
  };
};

function seedItem(patientId: string, id = 'item-1') {
  __state.items.push({
    id,
    patientId,
    exerciseId: 'ex-1',
    daysOfWeek: [1, 3],
    scheduledTime: '09:00',
    durationMinutes: 15,
    setsReps: '3x10',
    therapistNote: null,
    active: true,
    reminderJobKey: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    exercise: {
      nameEn: 'Squat',
      nameAr: 'قرفصاء',
      videoUrl: null,
      imageUrl: null,
      descriptionEn: '',
      descriptionAr: '',
      defaultInstructionEn: null,
      defaultInstructionAr: null,
    },
  });
}

const therapist = { user: { id: 'therapist-1', role: 'THERAPIST' } };
const doctor = { user: { id: 'doctor-1', role: 'DOCTOR' } };

beforeEach(() => {
  __state.approvals.clear();
  __state.items.length = 0;
  __state.auditLogs.length = 0;
  sessionRef.current = null;
});

describe('happy path: submit → approve → visible', () => {
  it('therapist submits → PENDING, then doctor approves → APPROVED + patient sees it', async () => {
    seedItem('p1');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    expect(__state.approvals.get('p1')?.status).toBe('PENDING_APPROVAL');
    // While pending and never-before approved, the patient sees nothing.
    expect(await getVisibleHomeProgram('p1')).toHaveLength(0);

    sessionRef.current = doctor;
    await approveHomeProgram('p1');
    expect(__state.approvals.get('p1')?.status).toBe('APPROVED');
    const visible = await getVisibleHomeProgram('p1');
    expect(visible.map((i) => i.id)).toEqual(['item-1']);
    expect(await remindersActive('p1')).toBe(true);
    expect(await programApproved('p1')).toBe(true);
    // Both transitions audited.
    expect(__state.auditLogs.filter((a) => a.entityType === 'HomeProgramApproval').length).toBe(2);
  });
});

describe('approved snapshot survives a therapist revision', () => {
  it('therapist edit of an approved program → PENDING, patient still served the approved snapshot', async () => {
    seedItem('p1', 'approved-item');
    sessionRef.current = doctor;
    await approveHomeProgram('p1'); // snapshot = [approved-item]

    // Therapist now edits (simulate: a new draft item replaces the live set) and
    // the edit hook flips APPROVED → PENDING.
    __state.items.length = 0;
    seedItem('p1', 'draft-item');
    sessionRef.current = therapist;
    await onHomeProgramEdited('p1');
    expect(__state.approvals.get('p1')?.status).toBe('PENDING_APPROVAL');

    // Patient still sees the APPROVED snapshot, not the new draft.
    const visible = await getVisibleHomeProgram('p1');
    expect(visible.map((i) => i.id)).toEqual(['approved-item']);
    // Reminders pause while pending.
    expect(await remindersActive('p1')).toBe(false);
  });
});

describe('doctor-created program auto-approves', () => {
  it('a doctor editing → APPROVED immediately (no submit), patient-visible', async () => {
    seedItem('p1');
    sessionRef.current = doctor;
    await onHomeProgramEdited('p1');
    expect(__state.approvals.get('p1')?.status).toBe('APPROVED');
    expect(await getVisibleHomeProgram('p1')).toHaveLength(1);
  });
});

describe('request changes', () => {
  it('requires a comment and moves to CHANGES_REQUESTED', async () => {
    seedItem('p1');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    sessionRef.current = doctor;
    await expect(requestHomeProgramChanges('p1', '   ')).rejects.toThrow();
    await requestHomeProgramChanges('p1', 'Reduce the squat reps');
    expect(__state.approvals.get('p1')?.status).toBe('CHANGES_REQUESTED');
    expect(__state.approvals.get('p1')?.changesComment).toBe('Reduce the squat reps');
  });
});

describe('reminders toggle', () => {
  it('disabling reminders stops delivery without changing approval status', async () => {
    seedItem('p1');
    sessionRef.current = doctor;
    await approveHomeProgram('p1');
    expect(await remindersActive('p1')).toBe(true);

    await setHomeProgramReminders('p1', false);
    expect(await remindersActive('p1')).toBe(false); // delivery off
    expect(await programApproved('p1')).toBe(true); // status unchanged
    expect(__state.approvals.get('p1')?.status).toBe('APPROVED');
    // Toggle is audited.
    expect(
      __state.auditLogs.some(
        (a) => (a.after as { event?: string })?.event === 'HOME_PROGRAM_REMINDERS_TOGGLED',
      ),
    ).toBe(true);
  });
});
