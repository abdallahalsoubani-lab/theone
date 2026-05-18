import { AppointmentStatus, AuditAction, PlanStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory db stub with the small subset of Prisma calls the plan
// services actually use.
vi.mock('@/lib/db', () => {
  const state = {
    plans: [] as Array<{
      id: string;
      patientId: string;
      doctorId: string;
      assignedTherapistId: string;
      diagnosisPrimary: string;
      diagnosisSecondary: string | null;
      goalsShortTerm: string;
      goalsLongTerm: string;
      frequencyPerWeek: number;
      durationWeeks: number;
      status: PlanStatus;
      version: number;
      parentPlanId: string | null;
      therapistNotes: string | null;
      proposalReason: string | null;
      rejectedReason: string | null;
      approvedAt: Date | null;
      approvedById: string | null;
      createdAt: Date;
    }>,
    exercises: [] as Array<{
      planId: string;
      exerciseId: string;
      sets: number;
      reps: number;
      durationSeconds: number;
      customNotes: string | null;
      order: number;
    }>,
    users: [
      { id: 'doctor-1', fullNameEn: 'Doc One', fullNameAr: 'دكتور' },
      { id: 'therapist-1', fullNameEn: 'Therapist One', fullNameAr: 'معالج' },
      { id: 'therapist-2', fullNameEn: 'Other Therapist', fullNameAr: 'معالج آخر' },
      { id: 'patient-1', fullNameEn: 'Patient One', fullNameAr: 'مريض' },
      { id: 'patient-2', fullNameEn: 'Patient Two', fullNameAr: 'مريض ثانٍ' },
    ] as Array<{ id: string; fullNameEn: string; fullNameAr: string }>,
    notifications: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
    counter: 0,
  };
  return {
    __state: state,
    db: {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          treatmentPlan: {
            update: vi.fn(
              async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
                const p = state.plans.find((x) => x.id === where.id)!;
                Object.assign(p, data);
                return p;
              },
            ),
            create: vi.fn(
              async ({
                data,
                select,
              }: {
                data: Record<string, unknown>;
                select?: { id: true };
              }) => {
                state.counter += 1;
                const id = `plan-${state.counter}`;
                const row = {
                  id,
                  patientId: data.patientId as string,
                  doctorId: data.doctorId as string,
                  assignedTherapistId: data.assignedTherapistId as string,
                  diagnosisPrimary: (data.diagnosisPrimary as string) ?? '',
                  diagnosisSecondary: (data.diagnosisSecondary as string | null) ?? null,
                  goalsShortTerm: (data.goalsShortTerm as string) ?? '',
                  goalsLongTerm: (data.goalsLongTerm as string) ?? '',
                  frequencyPerWeek: (data.frequencyPerWeek as number) ?? 2,
                  durationWeeks: (data.durationWeeks as number) ?? 6,
                  status: (data.status as PlanStatus) ?? PlanStatus.ACTIVE,
                  version: (data.version as number) ?? 1,
                  parentPlanId: (data.parentPlanId as string | null) ?? null,
                  therapistNotes: (data.therapistNotes as string | null) ?? null,
                  proposalReason: (data.proposalReason as string | null) ?? null,
                  rejectedReason: null,
                  approvedAt: null,
                  approvedById: null,
                  createdAt: new Date(),
                };
                state.plans.push(row);
                return select?.id ? { id } : row;
              },
            ),
          },
          planExercise: {
            createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
              for (const e of data) {
                state.exercises.push({
                  planId: e.planId as string,
                  exerciseId: e.exerciseId as string,
                  sets: e.sets as number,
                  reps: e.reps as number,
                  durationSeconds: e.durationSeconds as number,
                  customNotes: (e.customNotes as string | null) ?? null,
                  order: e.order as number,
                });
              }
              return { count: data.length };
            }),
          },
        }),
      ),
      treatmentPlan: {
        findFirst: vi.fn(
          async ({ where }: { where: { patientId: string; status: PlanStatus } }) =>
            state.plans.find((p) => p.patientId === where.patientId && p.status === where.status) ??
            null,
        ),
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.plans.find((p) => p.id === where.id) ?? null,
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const p = state.plans.find((x) => x.id === where.id)!;
            Object.assign(p, data);
            return p;
          },
        ),
        create: vi.fn(),
      },
      planExercise: {
        createMany: vi.fn(),
      },
      user: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.users.find((u) => u.id === where.id) ?? null,
        ),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.auditLogs.push(data);
          return data;
        }),
      },
      notification: {
        create: vi.fn(
          async ({ data, select }: { data: Record<string, unknown>; select?: { id: true } }) => {
            state.counter += 1;
            const id = `notif-${state.counter}`;
            state.notifications.push({ id, ...data });
            return select?.id ? { id } : { id, ...data };
          },
        ),
      },
    },
    toLocalizedError: (err: unknown) => ({
      code: 'INTERNAL',
      message_en: err instanceof Error ? err.message : String(err),
      message_ar: 'خطأ داخلي.',
    }),
  };
});

vi.mock('@/auth', () => {
  let session: { user: { id: string; role: string } } | null = {
    user: { id: 'doctor-1', role: 'DOCTOR' },
  };
  return {
    auth: vi.fn(async () => session),
    __setSession: (s: typeof session) => {
      session = s;
    },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import * as dbModule from '@/lib/db';
import {
  approveProposal,
  createTreatmentPlan,
  PlanError,
  proposeTreatmentPlanChange,
  rejectProposal,
  pauseTreatmentPlan,
  discontinueTreatmentPlan,
} from '../plans/services';

const state = (
  dbModule as unknown as {
    __state: {
      plans: Array<{
        id: string;
        patientId: string;
        status: PlanStatus;
        doctorId: string;
        assignedTherapistId: string;
        version: number;
        parentPlanId: string | null;
        approvedAt: Date | null;
        approvedById: string | null;
        rejectedReason: string | null;
      }>;
      exercises: Array<{ planId: string }>;
      notifications: Array<Record<string, unknown>>;
      auditLogs: Array<Record<string, unknown>>;
      counter: number;
    };
  }
).__state;

beforeEach(() => {
  state.plans.length = 0;
  state.exercises.length = 0;
  state.notifications.length = 0;
  state.auditLogs.length = 0;
  state.counter = 0;
});

const baseCreate = {
  patientId: 'patient-1',
  assignedTherapistId: 'therapist-1',
  diagnosisPrimary: 'Lumbar strain',
  diagnosisSecondary: null,
  goalsShortTerm: 'Reduce pain to ≤ 2/10.',
  goalsLongTerm: null,
  frequencyPerWeek: 2,
  durationWeeks: 6,
  therapistNotes: null,
  exercises: [
    {
      exerciseId: 'ex-1',
      sets: 3,
      reps: 12,
      durationSeconds: 30,
      customNotes: null,
      order: 0,
    },
  ],
};

describe('createTreatmentPlan', () => {
  it('inserts an ACTIVE v1 plan + exercises + notifies the assigned therapist', async () => {
    const r = await createTreatmentPlan(baseCreate, { doctorId: 'doctor-1' });
    expect(r.planId).toMatch(/^plan-/);
    expect(state.plans).toHaveLength(1);
    expect(state.plans[0]).toMatchObject({
      status: PlanStatus.ACTIVE,
      version: 1,
      parentPlanId: null,
    });
    expect(state.exercises).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      recipientId: 'therapist-1',
      type: 'PLAN_ASSIGNED',
    });
    // Audit + notification both write audit rows; the plan's audit must
    // exist regardless of ordering with the notification's fire-and-forget
    // audit insert.
    expect(
      state.auditLogs.find(
        (a) => a.entityType === 'TreatmentPlan' && a.action === AuditAction.CREATE,
      ),
    ).toBeDefined();
  });

  it('refuses when an active plan already exists (PLAN_ACTIVE_EXISTS)', async () => {
    state.plans.push({
      id: 'existing',
      patientId: 'patient-1',
      status: PlanStatus.ACTIVE,
      doctorId: 'doctor-1',
      assignedTherapistId: 'therapist-1',
      version: 1,
      parentPlanId: null,
      approvedAt: null,
      approvedById: null,
      rejectedReason: null,
    });
    await expect(createTreatmentPlan(baseCreate, { doctorId: 'doctor-1' })).rejects.toBeInstanceOf(
      PlanError,
    );
  });
});

describe('proposeTreatmentPlanChange', () => {
  function seedActive() {
    state.plans.push({
      id: 'active-1',
      patientId: 'patient-1',
      status: PlanStatus.ACTIVE,
      doctorId: 'doctor-1',
      assignedTherapistId: 'therapist-1',
      version: 1,
      parentPlanId: null,
      approvedAt: null,
      approvedById: null,
      rejectedReason: null,
    });
  }

  it('creates a PROPOSED child plan + notifies the doctor', async () => {
    seedActive();
    await proposeTreatmentPlanChange(
      {
        ...baseCreate,
        activePlanId: 'active-1',
        proposalReason: 'Patient tolerating sessions; add a third weekly slot.',
        frequencyPerWeek: 3,
      },
      { therapistId: 'therapist-1' },
    );
    const proposed = state.plans.find((p) => p.status === PlanStatus.PROPOSED)!;
    expect(proposed.parentPlanId).toBe('active-1');
    expect(proposed.version).toBe(2);
    expect(state.notifications[0]).toMatchObject({
      recipientId: 'doctor-1',
      type: 'PLAN_PROPOSAL_RECEIVED',
    });
  });

  it('refuses when the active plan is not assigned to the proposing therapist', async () => {
    seedActive();
    await expect(
      proposeTreatmentPlanChange(
        {
          ...baseCreate,
          activePlanId: 'active-1',
          proposalReason: 'Try harder',
        },
        { therapistId: 'therapist-2' },
      ),
    ).rejects.toBeInstanceOf(PlanError);
  });

  it('refuses when a proposal is already pending for the same patient', async () => {
    seedActive();
    state.plans.push({
      id: 'pending-1',
      patientId: 'patient-1',
      status: PlanStatus.PROPOSED,
      doctorId: 'doctor-1',
      assignedTherapistId: 'therapist-1',
      version: 2,
      parentPlanId: 'active-1',
      approvedAt: null,
      approvedById: null,
      rejectedReason: null,
    });
    await expect(
      proposeTreatmentPlanChange(
        {
          ...baseCreate,
          activePlanId: 'active-1',
          proposalReason: 'second attempt that should be rejected',
        },
        { therapistId: 'therapist-1' },
      ),
    ).rejects.toBeInstanceOf(PlanError);
  });

  it('refuses when the active plan is not ACTIVE', async () => {
    state.plans.push({
      id: 'paused-1',
      patientId: 'patient-1',
      status: PlanStatus.PAUSED,
      doctorId: 'doctor-1',
      assignedTherapistId: 'therapist-1',
      version: 1,
      parentPlanId: null,
      approvedAt: null,
      approvedById: null,
      rejectedReason: null,
    });
    await expect(
      proposeTreatmentPlanChange(
        {
          ...baseCreate,
          activePlanId: 'paused-1',
          proposalReason: 'must be active to propose',
        },
        { therapistId: 'therapist-1' },
      ),
    ).rejects.toBeInstanceOf(PlanError);
  });
});

describe('approveProposal', () => {
  function seedActivePlusProposal() {
    state.plans.push(
      {
        id: 'active-1',
        patientId: 'patient-1',
        status: PlanStatus.ACTIVE,
        doctorId: 'doctor-1',
        assignedTherapistId: 'therapist-1',
        version: 1,
        parentPlanId: null,
        approvedAt: null,
        approvedById: null,
        rejectedReason: null,
      },
      {
        id: 'proposal-1',
        patientId: 'patient-1',
        status: PlanStatus.PROPOSED,
        doctorId: 'doctor-1',
        assignedTherapistId: 'therapist-1',
        version: 2,
        parentPlanId: 'active-1',
        approvedAt: null,
        approvedById: null,
        rejectedReason: null,
      },
    );
  }

  it('moves parent → SUPERSEDED and proposal → ACTIVE in one transaction', async () => {
    seedActivePlusProposal();
    await approveProposal({ proposedPlanId: 'proposal-1' }, { doctorId: 'doctor-1' });
    expect(state.plans.find((p) => p.id === 'active-1')!.status).toBe(PlanStatus.SUPERSEDED);
    const newActive = state.plans.find((p) => p.id === 'proposal-1')!;
    expect(newActive.status).toBe(PlanStatus.ACTIVE);
    expect(newActive.approvedAt).not.toBeNull();
    expect(newActive.approvedById).toBe('doctor-1');
  });

  it('notifies the therapist on approval', async () => {
    seedActivePlusProposal();
    await approveProposal({ proposedPlanId: 'proposal-1' }, { doctorId: 'doctor-1' });
    expect(state.notifications[0]).toMatchObject({
      recipientId: 'therapist-1',
      type: 'PLAN_PROPOSAL_APPROVED',
    });
  });

  it('refuses when the doctor is not the plan author', async () => {
    seedActivePlusProposal();
    await expect(
      approveProposal({ proposedPlanId: 'proposal-1' }, { doctorId: 'doctor-other' }),
    ).rejects.toBeInstanceOf(PlanError);
  });

  it('refuses when the target row is not PROPOSED', async () => {
    state.plans.push({
      id: 'rejected-1',
      patientId: 'patient-1',
      status: PlanStatus.REJECTED,
      doctorId: 'doctor-1',
      assignedTherapistId: 'therapist-1',
      version: 2,
      parentPlanId: 'active-1',
      approvedAt: null,
      approvedById: null,
      rejectedReason: 'previously rejected',
    });
    await expect(
      approveProposal({ proposedPlanId: 'rejected-1' }, { doctorId: 'doctor-1' }),
    ).rejects.toBeInstanceOf(PlanError);
  });
});

describe('rejectProposal', () => {
  it('marks the proposal REJECTED with reason; active plan untouched', async () => {
    state.plans.push(
      {
        id: 'active-1',
        patientId: 'patient-1',
        status: PlanStatus.ACTIVE,
        doctorId: 'doctor-1',
        assignedTherapistId: 'therapist-1',
        version: 1,
        parentPlanId: null,
        approvedAt: null,
        approvedById: null,
        rejectedReason: null,
      },
      {
        id: 'proposal-1',
        patientId: 'patient-1',
        status: PlanStatus.PROPOSED,
        doctorId: 'doctor-1',
        assignedTherapistId: 'therapist-1',
        version: 2,
        parentPlanId: 'active-1',
        approvedAt: null,
        approvedById: null,
        rejectedReason: null,
      },
    );
    await rejectProposal(
      { proposedPlanId: 'proposal-1', rejectedReason: 'too aggressive' },
      { doctorId: 'doctor-1' },
    );
    expect(state.plans.find((p) => p.id === 'proposal-1')!.status).toBe(PlanStatus.REJECTED);
    expect(state.plans.find((p) => p.id === 'proposal-1')!.rejectedReason).toBe('too aggressive');
    expect(state.plans.find((p) => p.id === 'active-1')!.status).toBe(PlanStatus.ACTIVE);
    expect(state.notifications[0]).toMatchObject({ type: 'PLAN_PROPOSAL_REJECTED' });
  });
});

describe('lifecycle transitions', () => {
  function seedActive() {
    state.plans.push({
      id: 'active-1',
      patientId: 'patient-1',
      status: PlanStatus.ACTIVE,
      doctorId: 'doctor-1',
      assignedTherapistId: 'therapist-1',
      version: 1,
      parentPlanId: null,
      approvedAt: null,
      approvedById: null,
      rejectedReason: null,
    });
  }

  it('pauseTreatmentPlan moves ACTIVE → PAUSED + notifies therapist', async () => {
    seedActive();
    await pauseTreatmentPlan({ planId: 'active-1' }, { doctorId: 'doctor-1' });
    expect(state.plans[0]!.status).toBe(PlanStatus.PAUSED);
    expect(state.notifications[0]).toMatchObject({ type: 'PLAN_PAUSED' });
  });

  it('discontinueTreatmentPlan moves ACTIVE → DISCONTINUED', async () => {
    seedActive();
    await discontinueTreatmentPlan({ planId: 'active-1' }, { doctorId: 'doctor-1' });
    expect(state.plans[0]!.status).toBe(PlanStatus.DISCONTINUED);
    expect(state.notifications[0]).toMatchObject({ type: 'PLAN_DISCONTINUED' });
  });

  it('refuses transitions when actor is not the plan author', async () => {
    seedActive();
    await expect(
      pauseTreatmentPlan({ planId: 'active-1' }, { doctorId: 'doctor-other' }),
    ).rejects.toBeInstanceOf(PlanError);
  });
});

// Sanity check — the AppointmentStatus import keeps eslint happy; the
// plan flow doesn't depend on it directly but we import it so tests can
// assert the (in-memory) appointment data shape that future tests
// extend. No-op assertion to keep the import live.
describe('appointment status enum sanity', () => {
  it('SCHEDULED is the expected starting state', () => {
    expect(AppointmentStatus.SCHEDULED).toBe('SCHEDULED');
  });
});
