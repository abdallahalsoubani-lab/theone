import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 16 (revised by QA 7.8) — home-program approval state machine + the
 * data-layer guarantee that the patient (and reminder worker) only ever see
 * APPROVED content.
 *
 * QA 7.8 pins the EXPLICIT-submit machine: a therapist edit never
 * auto-submits. Editing an APPROVED program reopens a DRAFT revision
 * (snapshot preserved, no doctor notification); the therapist submits
 * explicitly from DRAFT / CHANGES_REQUESTED, and submitting from
 * PENDING_APPROVAL / APPROVED is rejected server-side.
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

// Care-team membership consulted by the services (manage scope) and the
// actions (submit / review gates).
const careTeamRef: { pairs: Array<{ clinicianId: string; patientId: string }> } = { pairs: [] };
vi.mock('@/lib/patients/assignment', () => ({
  getCareTeam: vi.fn(async () => ({
    doctors: [{ id: 'doctor-1', fullNameEn: 'D', fullNameAr: 'D' }],
    therapists: [],
  })),
  isClinicianAssignedTo: vi.fn(async (clinicianId: string, patientId: string) =>
    careTeamRef.pairs.some((p) => p.clinicianId === clinicianId && p.patientId === patientId),
  ),
}));

// BullMQ reminder helpers + env — keep the item services off Redis.
vi.mock('@/lib/queue/jobs/homeExerciseReminder', () => ({
  registerHomeReminderJob: vi.fn(async () => 'fake-repeat-key'),
  removeHomeReminderJob: vi.fn(async () => undefined),
}));
vi.mock('@/lib/env', () => ({ env: { HOME_REMINDER_OFFSET_MINUTES: 30 } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

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
    // NI-6 (Prompt 43): rows the dedup query consults — tests push here via
    // the createNotification mock to simulate delivered-but-unread.
    notifications: [] as Array<{
      recipientId: string;
      type: string;
      relatedEntityId: string | null;
      readAt: Date | null;
    }>,
    counter: 0,
  };
  const exerciseDetails = {
    nameEn: 'Squat',
    nameAr: 'قرفصاء',
    videoUrl: null,
    imageUrl: null,
    descriptionEn: '',
    descriptionAr: '',
    defaultInstructionEn: null,
    defaultInstructionAr: null,
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
        // NI-7 (Prompt 43): the doctor queue + sidebar badge reads.
        findMany: vi.fn(async ({ where }: { where: { status: string } }) =>
          [...state.approvals.entries()]
            .filter(([, row]) => row.status === where.status)
            .map(([patientId, row]) => ({
              patientId,
              submittedAt: (row.submittedAt as Date | null) ?? null,
              patient: { fullNameEn: 'P', fullNameAr: 'م' },
              submittedBy: row.submittedById ? { fullNameEn: 'T', fullNameAr: 'ت' } : null,
            })),
        ),
        count: vi.fn(
          async ({ where }: { where: { status: string } }) =>
            [...state.approvals.values()].filter((row) => row.status === where.status).length,
        ),
      },
      homeProgramItem: {
        findMany: vi.fn(async ({ where }: { where: { patientId: string } }) =>
          state.items.filter((i) => i.patientId === where.patientId),
        ),
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.items.find((i) => i.id === where.id) ?? null,
        ),
        create: vi.fn(
          async ({ data, select }: { data: Record<string, unknown>; select?: { id: true } }) => {
            state.counter += 1;
            const id = `item-${state.counter}`;
            const row: Item = {
              id,
              patientId: data.patientId as string,
              exerciseId: data.exerciseId as string,
              daysOfWeek: data.daysOfWeek as number[],
              scheduledTime: data.scheduledTime as string,
              durationMinutes: data.durationMinutes as number,
              setsReps: (data.setsReps as string | null) ?? null,
              therapistNote: (data.therapistNote as string | null) ?? null,
              active: data.active as boolean,
              reminderJobKey: null,
              createdAt: new Date('2026-06-01T00:00:00Z'),
              exercise: exerciseDetails,
            };
            state.items.push(row);
            return select?.id ? { id } : row;
          },
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const item = state.items.find((i) => i.id === where.id)!;
            Object.assign(item, data);
            return item;
          },
        ),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          const idx = state.items.findIndex((i) => i.id === where.id);
          if (idx !== -1) state.items.splice(idx, 1);
          return { id: where.id };
        }),
        // Reviewer item-count signal on the queue rows (NI-7 test path).
        groupBy: vi.fn(async ({ where }: { where: { patientId: { in: string[] } } }) => {
          const counts = new Map<string, number>();
          for (const i of state.items) {
            if (!i.active || !where.patientId.in.includes(i.patientId)) continue;
            counts.set(i.patientId, (counts.get(i.patientId) ?? 0) + 1);
          }
          return [...counts.entries()].map(([patientId, n]) => ({
            patientId,
            _count: { _all: n },
          }));
        }),
      },
      exercise: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'ex-1' ? { id: 'ex-1', active: true, replacedById: null } : null,
        ),
      },
      user: {
        findUnique: vi.fn(async () => ({ fullNameEn: 'Name' })),
      },
      // NI-6 (Prompt 43): the doctor-edit notification dedup (unread) query.
      notification: {
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: { recipientId: string; type: string; relatedEntityId: string };
          }) =>
            state.notifications.find(
              (n) =>
                n.recipientId === where.recipientId &&
                n.type === where.type &&
                n.relatedEntityId === where.relatedEntityId &&
                n.readAt === null,
            ) ?? null,
        ),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.auditLogs.push(data);
          return data;
        }),
      },
    },
    toLocalizedError: (err: unknown) => ({
      code: 'INTERNAL',
      message_en: err instanceof Error ? err.message : String(err),
      message_ar: 'خطأ.',
    }),
  };
});

import { createNotification } from '@/lib/notifications/actions';
import { getCareTeam } from '@/lib/patients/assignment';
import { ForbiddenError } from '@/lib/rbac/guards';

import {
  approveHomeProgram,
  countPendingApprovals,
  getVisibleHomeProgram,
  HomeProgramApprovalError,
  listPendingApprovals,
  onHomeProgramEdited,
  reopenHomeProgramDraft,
  requestHomeProgramChanges,
  submitHomeProgram,
} from '../approval';
import { canSubmitHomeProgram } from '../policy';
import {
  approveHomeProgramAction,
  requestHomeProgramChangesAction,
  submitHomeProgramAction,
} from '../actions';
import { addHomeProgramItem, updateHomeProgramItem } from '../services';
import { getApprovalState, programApproved, remindersActive } from '../visibility';
import { setHomeProgramReminders } from '../approval';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    approvals: Map<string, Record<string, unknown>>;
    items: Array<Record<string, unknown>>;
    auditLogs: Array<Record<string, unknown>>;
    notifications: Array<{
      recipientId: string;
      type: string;
      relatedEntityId: string | null;
      readAt: Date | null;
    }>;
    counter: number;
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

function auditEvents(): string[] {
  return __state.auditLogs
    .filter((a) => a.entityType === 'HomeProgramApproval')
    .map((a) => (a.after as { event?: string })?.event ?? '');
}

beforeEach(() => {
  __state.approvals.clear();
  __state.items.length = 0;
  __state.auditLogs.length = 0;
  __state.notifications.length = 0;
  __state.counter = 0;
  sessionRef.current = null;
  careTeamRef.pairs = [
    { clinicianId: 'therapist-1', patientId: 'p1' },
    { clinicianId: 'doctor-1', patientId: 'p1' },
  ];
  vi.mocked(createNotification).mockClear();
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

describe('full explicit-submit flow (QA 7.8)', () => {
  it('add → DRAFT (no auto-submit), submit → PENDING, changes → edit stays, resubmit, approve', async () => {
    sessionRef.current = therapist;

    // 1. Therapist adds an item — lands in DRAFT, no doctor notification.
    const added = await addHomeProgramItem(
      {
        patientId: 'p1',
        exerciseId: 'ex-1',
        daysOfWeek: [1, 3],
        scheduledTime: '09:00',
        durationMinutes: 15,
        setsReps: '3x10',
        therapistNote: null,
      },
      { actorId: 'therapist-1' },
    );
    expect(__state.approvals.get('p1')?.status).toBe('DRAFT');
    expect(vi.mocked(createNotification)).not.toHaveBeenCalled();

    // 2. Explicit submit → PENDING_APPROVAL + doctor notified + audited.
    const submitted = await submitHomeProgramAction('p1');
    expect(submitted.ok).toBe(true);
    expect(__state.approvals.get('p1')).toMatchObject({
      status: 'PENDING_APPROVAL',
      submittedById: 'therapist-1',
    });
    expect(__state.approvals.get('p1')?.submittedAt).toBeInstanceOf(Date);
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'doctor-1', type: 'HOME_PROGRAM_SUBMITTED' }),
    );
    expect(auditEvents()).toContain('HOME_PROGRAM_SUBMITTED');

    // 3. Doctor requests changes → CHANGES_REQUESTED + comment stored.
    sessionRef.current = doctor;
    const changes = await requestHomeProgramChangesAction('p1', 'Reduce the squat reps');
    expect(changes.ok).toBe(true);
    expect(__state.approvals.get('p1')).toMatchObject({
      status: 'CHANGES_REQUESTED',
      changesComment: 'Reduce the squat reps',
    });

    // 4. Therapist edits while CHANGES_REQUESTED — status does NOT move.
    sessionRef.current = therapist;
    await updateHomeProgramItem(
      {
        id: added.itemId,
        patientId: 'p1',
        exerciseId: 'ex-1',
        daysOfWeek: [1],
        scheduledTime: '10:00',
        durationMinutes: 10,
        setsReps: '2x10',
        therapistNote: null,
        active: true,
      },
      { actorId: 'therapist-1' },
    );
    expect(__state.approvals.get('p1')?.status).toBe('CHANGES_REQUESTED');

    // 5. Explicit resubmit → PENDING_APPROVAL again.
    const resubmitted = await submitHomeProgramAction('p1');
    expect(resubmitted.ok).toBe(true);
    expect(__state.approvals.get('p1')?.status).toBe('PENDING_APPROVAL');

    // 6. Doctor approves → APPROVED, snapshot refreshed, comment cleared,
    //    therapist notified.
    sessionRef.current = doctor;
    const approved = await approveHomeProgramAction('p1');
    expect(approved.ok).toBe(true);
    expect(__state.approvals.get('p1')).toMatchObject({
      status: 'APPROVED',
      changesComment: null,
    });
    const snapshot = __state.approvals.get('p1')?.approvedSnapshot as Array<{ id: string }>;
    expect(snapshot.map((i) => i.id)).toEqual([added.itemId]);
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'therapist-1', type: 'HOME_PROGRAM_APPROVED' }),
    );
    expect(await remindersActive('p1')).toBe(true);
  });
});

describe('therapist edit of an APPROVED program reopens a DRAFT (QA 7.8 regression)', () => {
  it('→ DRAFT (not PENDING), snapshot preserved, patient still served the approved snapshot, no doctor notification', async () => {
    seedItem('p1', 'approved-item');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    sessionRef.current = doctor;
    await approveHomeProgram('p1'); // snapshot = [approved-item]

    // Therapist now edits (simulate: a new draft item replaces the live set)
    // and the edit hook reopens the working DRAFT.
    __state.items.length = 0;
    seedItem('p1', 'draft-item');
    sessionRef.current = therapist;
    vi.mocked(createNotification).mockClear();
    await onHomeProgramEdited('p1');

    expect(__state.approvals.get('p1')).toMatchObject({
      status: 'DRAFT',
      submittedById: null,
      submittedAt: null,
    });
    // Nothing was submitted — the doctor is NOT notified.
    expect(vi.mocked(createNotification)).not.toHaveBeenCalled();
    // The reopen is audited.
    expect(auditEvents()).toContain('HOME_PROGRAM_REOPENED_DRAFT');

    // Patient still sees the APPROVED snapshot, not the new draft.
    const visible = await getVisibleHomeProgram('p1');
    expect(visible.map((i) => i.id)).toEqual(['approved-item']);
    // Reminders pause while the revision is a draft.
    expect(await remindersActive('p1')).toBe(false);
    // The builder hint has what it needs (DRAFT + snapshot present).
    expect(await getApprovalState('p1')).toMatchObject({
      status: 'DRAFT',
      hasApprovedSnapshot: true,
    });
  });

  it('backfill guard: APPROVED with NULL snapshot freezes the live items before reopening', async () => {
    // Simulate the 20260612100000 migration backfill: APPROVED, no snapshot.
    __state.approvals.set('p1', {
      patientId: 'p1',
      status: 'APPROVED',
      approvedSnapshot: null,
      remindersEnabled: true,
    });
    seedItem('p1', 'live-item');

    sessionRef.current = therapist;
    await onHomeProgramEdited('p1');

    expect(__state.approvals.get('p1')?.status).toBe('DRAFT');
    const snapshot = __state.approvals.get('p1')?.approvedSnapshot as Array<{ id: string }>;
    expect(snapshot.map((i) => i.id)).toEqual(['live-item']);
    // The patient's program did not blank out.
    const visible = await getVisibleHomeProgram('p1');
    expect(visible.map((i) => i.id)).toEqual(['live-item']);
  });

  it('reopen preserves an existing snapshot (never cleared, never rebuilt)', async () => {
    seedItem('p1', 'approved-item');
    sessionRef.current = doctor;
    await approveHomeProgram('p1');
    const frozen = __state.approvals.get('p1')?.approvedSnapshot;

    __state.items.length = 0;
    seedItem('p1', 'draft-item');
    sessionRef.current = therapist;
    await reopenHomeProgramDraft('p1');
    expect(__state.approvals.get('p1')?.approvedSnapshot).toBe(frozen);
  });
});

describe('submit from-state guard (QA 7.8)', () => {
  it('rejects submitting from PENDING_APPROVAL', async () => {
    seedItem('p1');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    await expect(submitHomeProgram('p1')).rejects.toBeInstanceOf(HomeProgramApprovalError);
    expect(__state.approvals.get('p1')?.status).toBe('PENDING_APPROVAL');
  });

  it('rejects submitting from APPROVED (edit first to reopen a draft)', async () => {
    seedItem('p1');
    sessionRef.current = doctor;
    await approveHomeProgram('p1');
    sessionRef.current = therapist;
    await expect(submitHomeProgram('p1')).rejects.toBeInstanceOf(HomeProgramApprovalError);
    expect(__state.approvals.get('p1')?.status).toBe('APPROVED');
  });

  it('surfaces the guard as a localized failure through the action', async () => {
    seedItem('p1');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    const r = await submitHomeProgramAction('p1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('HOME_PROGRAM_ALREADY_SUBMITTED');
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

describe('RBAC denials (action boundary)', () => {
  it('submit is forbidden for a therapist NOT on the care team', async () => {
    seedItem('p1');
    sessionRef.current = { user: { id: 'therapist-2', role: 'THERAPIST' } };
    const r = await submitHomeProgramAction('p1');
    expect(r.ok).toBe(false);
    expect(__state.approvals.get('p1')).toBeUndefined();
  });

  it('approve / request-changes are forbidden for THERAPIST (requirePermission throws)', async () => {
    seedItem('p1');
    sessionRef.current = therapist;
    await expect(approveHomeProgramAction('p1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestHomeProgramChangesAction('p1', 'no')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('approve is forbidden for a doctor NOT on the care team', async () => {
    seedItem('p1');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    sessionRef.current = { user: { id: 'doctor-2', role: 'DOCTOR' } };
    const r = await approveHomeProgramAction('p1');
    expect(r.ok).toBe(false);
    expect(__state.approvals.get('p1')?.status).toBe('PENDING_APPROVAL');
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

// ─── Prompt 43 additions ────────────────────────────────────────────────────

describe('doctor edit notifies the therapist (NI-6, Prompt 43)', () => {
  it('doctor edits a submitted program → HOME_PROGRAM_DOCTOR_EDITED to the submitter, with the real builder link — and NOT a misleading "approved"', async () => {
    seedItem('p1');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    // Submit-side notification (P16, unchanged): care-team doctor got told.
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'HOME_PROGRAM_SUBMITTED', recipientId: 'doctor-1' }),
    );
    vi.mocked(createNotification).mockClear();

    sessionRef.current = doctor;
    await onHomeProgramEdited('p1');

    // PT-B2 item 3: editing while reviewing is part of the review, not the
    // decision — the program stays in the queue until the doctor approves or
    // returns it explicitly. The NI-6 notification still fires unchanged.
    expect(__state.approvals.get('p1')?.status).toBe('PENDING_APPROVAL');
    expect(vi.mocked(createNotification)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'HOME_PROGRAM_DOCTOR_EDITED',
        recipientId: 'therapist-1',
        linkPath: '/therapist/patients/p1/home-program/edit',
        relatedEntityId: 'p1',
      }),
    );
  });

  it('dedupes on UNREAD: editing five items in one sitting produces one notification', async () => {
    seedItem('p1');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    vi.mocked(createNotification).mockClear();
    // Wire the mock to actually record rows so the dedup query sees them.
    vi.mocked(createNotification).mockImplementation(async (args) => {
      __state.notifications.push({
        recipientId: args.recipientId,
        type: args.type,
        relatedEntityId: args.relatedEntityId ?? null,
        readAt: null,
      });
      return { id: 'n' };
    });

    sessionRef.current = doctor;
    await onHomeProgramEdited('p1');
    await onHomeProgramEdited('p1');
    await onHomeProgramEdited('p1');

    const edits = __state.notifications.filter((n) => n.type === 'HOME_PROGRAM_DOCTOR_EDITED');
    expect(edits).toHaveLength(1);

    // Once the therapist read it, the next doctor edit notifies again.
    edits[0]!.readAt = new Date();
    await onHomeProgramEdited('p1');
    expect(
      __state.notifications.filter((n) => n.type === 'HOME_PROGRAM_DOCTOR_EDITED'),
    ).toHaveLength(2);
  });

  it('no submitter on record → falls back to the care-team therapists', async () => {
    seedItem('p1');
    vi.mocked(getCareTeam).mockResolvedValueOnce({
      doctors: [{ id: 'doctor-1', fullNameEn: 'D', fullNameAr: 'د' }],
      therapists: [{ id: 'therapist-1', fullNameEn: 'T', fullNameAr: 'ت' }],
    } as never);
    sessionRef.current = doctor;
    await onHomeProgramEdited('p1');
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'HOME_PROGRAM_DOCTOR_EDITED', recipientId: 'therapist-1' }),
    );
  });

  it('never notifies the editor about their own edit', async () => {
    seedItem('p1');
    __state.approvals.set('p1', { status: 'DRAFT', submittedById: 'doctor-1' });
    sessionRef.current = doctor;
    await onHomeProgramEdited('p1');
    expect(vi.mocked(createNotification)).not.toHaveBeenCalled();
  });
});

describe('submit availability rule (P-2, Prompt 43)', () => {
  it('DRAFT and CHANGES_REQUESTED are submittable; PENDING_APPROVAL and APPROVED are not', () => {
    expect(canSubmitHomeProgram('DRAFT')).toBe(true);
    expect(canSubmitHomeProgram('CHANGES_REQUESTED')).toBe(true);
    expect(canSubmitHomeProgram('PENDING_APPROVAL')).toBe(false);
    expect(canSubmitHomeProgram('APPROVED')).toBe(false);
  });

  it('mirrors the server guard exactly (UI truth == submitHomeProgram truth)', async () => {
    seedItem('p1');
    sessionRef.current = therapist;
    // Both non-submittable states are the exact ones the server rejects.
    for (const status of ['PENDING_APPROVAL', 'APPROVED'] as const) {
      __state.approvals.set('p1', { status });
      expect(canSubmitHomeProgram(status)).toBe(false);
      await expect(submitHomeProgram('p1')).rejects.toBeInstanceOf(HomeProgramApprovalError);
    }
  });
});

describe('approvals queue scope + sidebar count (NI-7, Prompt 43)', () => {
  it('lists and counts PENDING_APPROVAL only — plans and other states never land here', async () => {
    __state.approvals.set('p1', { status: 'PENDING_APPROVAL', submittedById: 'therapist-1' });
    __state.approvals.set('p2', { status: 'APPROVED' });
    __state.approvals.set('p3', { status: 'DRAFT' });
    __state.approvals.set('p4', { status: 'CHANGES_REQUESTED' });

    const rows = await listPendingApprovals(null);
    expect(rows.map((r) => r.patientId)).toEqual(['p1']);
    expect(await countPendingApprovals(null)).toBe(1);
  });
});

describe('unsent changes after submitting (PT-B2 item 2)', () => {
  it('a therapist edit while PENDING reopens a DRAFT so the program can be re-sent', async () => {
    // The reported dead end: submit, then keep adding exercises. The status
    // stayed PENDING, which hides the submit button — changed content with no
    // way to send it, and the doctor would have approved whatever was live.
    seedItem('p1', 'first-item');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    expect(canSubmitHomeProgram('PENDING_APPROVAL')).toBe(false);

    seedItem('p1', 'added-after-submit');
    await onHomeProgramEdited('p1');

    const state = await getApprovalState('p1');
    expect(state.status).toBe('DRAFT');
    expect(state.submittedAt).toBeNull();
    // The submit button comes back, and re-submitting is accepted.
    expect(canSubmitHomeProgram(state.status)).toBe(true);
    await expect(submitHomeProgram('p1')).resolves.toMatchObject({
      status: 'PENDING_APPROVAL',
    });
  });

  it('reopening a never-approved program does not freeze the draft as approved content', async () => {
    // The snapshot backfill guard exists for rows APPROVED by migration with a
    // NULL snapshot. It must not fire here — freezing an unapproved draft
    // would publish it to the patient as if a doctor had signed it off.
    seedItem('p1', 'never-approved');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    await onHomeProgramEdited('p1');

    expect((await getApprovalState('p1')).status).toBe('DRAFT');
    // Nothing was frozen, so the patient still has no program at all.
    expect(__state.approvals.get('p1')?.approvedSnapshot).toBeUndefined();
    expect(await getVisibleHomeProgram('p1')).toEqual([]);
  });

  it('re-submitting clears the doctor’s previous changes note', async () => {
    seedItem('p1', 'item-1');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    sessionRef.current = doctor;
    await requestHomeProgramChanges('p1', 'Please lower the reps.');
    expect(await getApprovalState('p1')).toMatchObject({
      status: 'CHANGES_REQUESTED',
      changesComment: 'Please lower the reps.',
    });

    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    expect(await getApprovalState('p1')).toMatchObject({
      status: 'PENDING_APPROVAL',
      changesComment: null,
    });
  });

  it('the full round trip: draft → submit → returned → edit → submit → approved', async () => {
    seedItem('p1', 'item-1');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');
    sessionRef.current = doctor;
    await requestHomeProgramChanges('p1', 'Swap the second exercise.');

    sessionRef.current = therapist;
    seedItem('p1', 'item-2');
    await onHomeProgramEdited('p1');
    // CHANGES_REQUESTED survives an edit — the doctor's note stays readable.
    expect((await getApprovalState('p1')).status).toBe('CHANGES_REQUESTED');
    await submitHomeProgram('p1');

    sessionRef.current = doctor;
    await approveHomeProgram('p1');

    expect((await getApprovalState('p1')).status).toBe('APPROVED');
    expect((await getVisibleHomeProgram('p1')).map((i) => i.id)).toEqual(['item-1', 'item-2']);
  });
});

describe('doctor reviews, edits, then approves in one step (PT-B2 item 3)', () => {
  it('the edit stays PENDING and the later approve carries it into the approved program', async () => {
    // The reported dead end: the doctor opened the program, edited it, and had
    // no way back to approve — so it stayed pending. Editing must not decide
    // anything, and approving must include what was just edited.
    seedItem('p1', 'as-submitted');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');

    sessionRef.current = doctor;
    seedItem('p1', 'doctor-added');
    await onHomeProgramEdited('p1');

    // Still in the queue — the decision has not been made yet.
    expect((await getApprovalState('p1')).status).toBe('PENDING_APPROVAL');
    expect((await listPendingApprovals(null)).map((r) => r.patientId)).toEqual(['p1']);
    // And the patient is not following the doctor's unapproved edit.
    expect(await getVisibleHomeProgram('p1')).toEqual([]);

    await approveHomeProgram('p1');

    expect((await getApprovalState('p1')).status).toBe('APPROVED');
    expect((await getVisibleHomeProgram('p1')).map((i) => i.id)).toEqual([
      'as-submitted',
      'doctor-added',
    ]);
    // The queue is clear.
    expect(await countPendingApprovals(null)).toBe(0);
  });

  it('returning it after an edit sends it back as CHANGES_REQUESTED with the note', async () => {
    seedItem('p1', 'as-submitted');
    sessionRef.current = therapist;
    await submitHomeProgram('p1');

    sessionRef.current = doctor;
    await onHomeProgramEdited('p1');
    await requestHomeProgramChanges('p1', 'Reduce to three sessions a week.');

    expect(await getApprovalState('p1')).toMatchObject({
      status: 'CHANGES_REQUESTED',
      changesComment: 'Reduce to three sessions a week.',
    });
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'HOME_PROGRAM_CHANGES_REQUESTED',
        recipientId: 'therapist-1',
      }),
    );
    // Back with the therapist, who can send it again.
    expect(canSubmitHomeProgram('CHANGES_REQUESTED')).toBe(true);
  });

  it('a doctor building a program with nothing under review still auto-approves', async () => {
    // The pre-existing "the doctor IS the approver" path must not regress.
    sessionRef.current = doctor;
    seedItem('p1', 'doctor-built');
    await onHomeProgramEdited('p1');

    expect((await getApprovalState('p1')).status).toBe('APPROVED');
    expect((await getVisibleHomeProgram('p1')).map((i) => i.id)).toEqual(['doctor-built']);
  });
});
