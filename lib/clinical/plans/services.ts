import { AuditAction, PlanStatus, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { createNotification } from '@/lib/notifications/actions';
import { addCareTeamMemberTx } from '@/lib/patients/assignment';

import type { PlanCreateInput, PlanProposeInput } from './schemas';

/**
 * Treatment plan services (Prompt 9 §4.3-§4.5).
 *
 * Three core mutations:
 *   - createTreatmentPlan      (Doctor authors the initial plan)
 *   - proposeTreatmentPlanChange (Therapist proposes a revision)
 *   - approveProposal / rejectProposal (Doctor reviews the proposal)
 *
 * Plus four lifecycle transitions on the ACTIVE plan: pause, resume,
 * complete, discontinue. Each is audited and notifies the assigned
 * therapist where appropriate.
 *
 * The proposal flow encodes the clinical hierarchy (Doctor owns the
 * plan, Therapist proposes adjustments). Resist any "convenience"
 * branch that would let the Therapist edit directly — Spec §5.5 / FR-
 * PLAN-4 keeps the doctor as the gatekeeper.
 */

export class PlanError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'PlanError';
  }
}

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};
const notFound: LocalizedError = {
  code: 'PLAN_NOT_FOUND',
  message_en: 'Treatment plan not found.',
  message_ar: 'لم يتم العثور على خطة العلاج.',
};
const forbidden: LocalizedError = {
  code: 'PLAN_FORBIDDEN',
  message_en: 'You are not authorized to act on this plan.',
  message_ar: 'غير مصرح لك بالتصرف على هذه الخطة.',
};
const conflictActive: LocalizedError = {
  code: 'PLAN_ACTIVE_EXISTS',
  message_en:
    'An active treatment plan already exists for this patient. Complete or discontinue it before creating a new one.',
  message_ar:
    'توجد بالفعل خطة علاج نشطة لهذا المريض. يرجى إكمالها أو إيقافها قبل إنشاء واحدة جديدة.',
};
const conflictProposal: LocalizedError = {
  code: 'PLAN_PROPOSAL_PENDING',
  message_en:
    'A proposed revision is already pending for this patient. Resolve it before submitting another.',
  message_ar: 'يوجد اقتراح تعديل قيد المراجعة لهذا المريض. يرجى حسمه قبل تقديم اقتراح آخر.',
};
const notProposed: LocalizedError = {
  code: 'PLAN_NOT_PROPOSED',
  message_en: 'Only PROPOSED plans can be approved or rejected.',
  message_ar: 'يمكن الموافقة على/رفض الخطط المقترحة فقط.',
};
const notActive: LocalizedError = {
  code: 'PLAN_NOT_ACTIVE',
  message_en: 'Only ACTIVE plans can transition here.',
  message_ar: 'يمكن الانتقال هنا فقط من الخطط النشطة.',
};

async function fullName(userId: string, locale: 'en' | 'ar' = 'en'): Promise<string> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { fullNameEn: true, fullNameAr: true },
  });
  if (!u) return '';
  return locale === 'ar' ? u.fullNameAr : u.fullNameEn;
}

// ─── Create ─────────────────────────────────────────────────────────────────
export const createTreatmentPlan = withAudit<
  [PlanCreateInput, { doctorId: string }],
  { planId: string }
>(
  {
    entityType: 'TreatmentPlan',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.planId,
    extractAfter: () => ({ event: 'CREATED' }) as Prisma.InputJsonValue,
  },
  async function createInner(input, ctx): Promise<{ planId: string }> {
    const existing = await db.treatmentPlan.findFirst({
      where: { patientId: input.patientId, status: PlanStatus.ACTIVE },
      select: { id: true },
    });
    if (existing) throw new PlanError(conflictActive);

    const plan = await db.$transaction(async (tx) => {
      const created = await tx.treatmentPlan.create({
        data: {
          patientId: input.patientId,
          doctorId: ctx.doctorId,
          assignedTherapistId: input.assignedTherapistId,
          diagnosisPrimary: input.diagnosisPrimary,
          diagnosisSecondary: input.diagnosisSecondary,
          goalsShortTerm: input.goalsShortTerm,
          goalsLongTerm: input.goalsLongTerm ?? '',
          frequencyPerWeek: input.frequencyPerWeek,
          durationWeeks: input.durationWeeks,
          therapistNotes: input.therapistNotes,
          status: PlanStatus.ACTIVE,
          version: 1,
          parentPlanId: null,
        },
        select: { id: true },
      });
      await tx.planExercise.createMany({
        data: input.exercises.map((e) => ({
          planId: created.id,
          exerciseId: e.exerciseId,
          sets: e.sets,
          reps: e.reps,
          durationSeconds: e.durationSeconds,
          customNotes: e.customNotes ?? null,
          order: e.order,
        })),
      });
      // FR-PAT-3: authoring a plan adds this doctor to the patient's care team
      // so they appear in the doctor's "My patients" list / dashboard.
      // Idempotent — never removes or replaces other members.
      await addCareTeamMemberTx(tx, input.patientId, ctx.doctorId, ctx.doctorId);
      return created;
    });

    // Fan out the assignment notification. Failure is logged but not
    // propagated — the plan exists and the doctor is told it succeeded;
    // the notification is best-effort. The session is the doctor.
    const [doctorName, patientName] = await Promise.all([
      fullName(ctx.doctorId),
      fullName(input.patientId),
    ]);
    await createNotification({
      recipientId: input.assignedTherapistId,
      type: 'PLAN_ASSIGNED',
      params: { doctorName, patientName },
      linkPath: `/therapist/plans/${plan.id}`,
      relatedEntityType: 'TreatmentPlan',
      relatedEntityId: plan.id,
    }).catch((err: unknown) => {
      console.error('[plans] notification PLAN_ASSIGNED failed', err);
    });

    return { planId: plan.id };
  },
);

// ─── Propose change ─────────────────────────────────────────────────────────
export const proposeTreatmentPlanChange = withAudit<
  [PlanProposeInput, { therapistId: string }],
  { planId: string }
>(
  {
    entityType: 'TreatmentPlan',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.planId,
    extractAfter: () => ({ event: 'PROPOSED' }) as Prisma.InputJsonValue,
  },
  async function proposeInner(input, ctx): Promise<{ planId: string }> {
    const active = await db.treatmentPlan.findUnique({
      where: { id: input.activePlanId },
      select: {
        id: true,
        patientId: true,
        doctorId: true,
        assignedTherapistId: true,
        status: true,
        version: true,
      },
    });
    if (!active) throw new PlanError(notFound);
    if (active.status !== PlanStatus.ACTIVE) throw new PlanError(notActive);
    if (active.assignedTherapistId !== ctx.therapistId) throw new PlanError(forbidden);
    if (active.patientId !== input.patientId) throw new PlanError(forbidden);

    // Guard against double-proposals before we hit the partial unique
    // index — the index protects us at write time, but a friendly error
    // beats a Prisma P2002.
    const pending = await db.treatmentPlan.findFirst({
      where: { patientId: input.patientId, status: PlanStatus.PROPOSED },
      select: { id: true },
    });
    if (pending) throw new PlanError(conflictProposal);

    const proposed = await db.$transaction(async (tx) => {
      const created = await tx.treatmentPlan.create({
        data: {
          patientId: input.patientId,
          doctorId: active.doctorId,
          assignedTherapistId: input.assignedTherapistId,
          parentPlanId: active.id,
          version: active.version + 1,
          diagnosisPrimary: input.diagnosisPrimary,
          diagnosisSecondary: input.diagnosisSecondary,
          goalsShortTerm: input.goalsShortTerm,
          goalsLongTerm: input.goalsLongTerm ?? '',
          frequencyPerWeek: input.frequencyPerWeek,
          durationWeeks: input.durationWeeks,
          therapistNotes: input.therapistNotes,
          status: PlanStatus.PROPOSED,
          proposalReason: input.proposalReason,
        },
        select: { id: true },
      });
      await tx.planExercise.createMany({
        data: input.exercises.map((e) => ({
          planId: created.id,
          exerciseId: e.exerciseId,
          sets: e.sets,
          reps: e.reps,
          durationSeconds: e.durationSeconds,
          customNotes: e.customNotes ?? null,
          order: e.order,
        })),
      });
      return created;
    });

    const [therapistName, patientName] = await Promise.all([
      fullName(ctx.therapistId),
      fullName(input.patientId),
    ]);
    await createNotification({
      recipientId: active.doctorId,
      type: 'PLAN_PROPOSAL_RECEIVED',
      params: { therapistName, patientName, reason: input.proposalReason },
      linkPath: `/doctor/plans/${proposed.id}`,
      relatedEntityType: 'TreatmentPlan',
      relatedEntityId: proposed.id,
    }).catch((err: unknown) => {
      console.error('[plans] notification PLAN_PROPOSAL_RECEIVED failed', err);
    });

    return { planId: proposed.id };
  },
);

// ─── Approve proposal ───────────────────────────────────────────────────────
export const approveProposal = withAudit<
  [{ proposedPlanId: string }, { doctorId: string }],
  { activePlanId: string }
>(
  {
    entityType: 'TreatmentPlan',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].proposedPlanId,
    extractAfter: () => ({ event: 'PROPOSAL_APPROVED' }) as Prisma.InputJsonValue,
  },
  async function approveInner({ proposedPlanId }, ctx): Promise<{ activePlanId: string }> {
    const proposed = await db.treatmentPlan.findUnique({
      where: { id: proposedPlanId },
      select: {
        id: true,
        patientId: true,
        doctorId: true,
        status: true,
        parentPlanId: true,
        assignedTherapistId: true,
      },
    });
    if (!proposed) throw new PlanError(notFound);
    if (proposed.status !== PlanStatus.PROPOSED) throw new PlanError(notProposed);
    // Doctor approval is gated to the plan's authoring doctor — the
    // RBAC permission grants the capability, this check binds it to
    // the right row.
    if (proposed.doctorId !== ctx.doctorId) throw new PlanError(forbidden);

    await db.$transaction(async (tx) => {
      if (proposed.parentPlanId) {
        await tx.treatmentPlan.update({
          where: { id: proposed.parentPlanId },
          data: { status: PlanStatus.SUPERSEDED },
        });
      }
      await tx.treatmentPlan.update({
        where: { id: proposed.id },
        data: {
          status: PlanStatus.ACTIVE,
          approvedAt: new Date(),
          approvedById: ctx.doctorId,
        },
      });
    });

    const [doctorName, patientName] = await Promise.all([
      fullName(ctx.doctorId),
      fullName(proposed.patientId),
    ]);
    await createNotification({
      recipientId: proposed.assignedTherapistId,
      type: 'PLAN_PROPOSAL_APPROVED',
      params: { doctorName, patientName },
      linkPath: `/therapist/plans/${proposed.id}`,
      relatedEntityType: 'TreatmentPlan',
      relatedEntityId: proposed.id,
    }).catch((err: unknown) => {
      console.error('[plans] notification PLAN_PROPOSAL_APPROVED failed', err);
    });

    return { activePlanId: proposed.id };
  },
);

// ─── Reject proposal ────────────────────────────────────────────────────────
export const rejectProposal = withAudit<
  [{ proposedPlanId: string; rejectedReason: string }, { doctorId: string }],
  { planId: string }
>(
  {
    entityType: 'TreatmentPlan',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].proposedPlanId,
    extractAfter: () => ({ event: 'PROPOSAL_REJECTED' }) as Prisma.InputJsonValue,
  },
  async function rejectInner({ proposedPlanId, rejectedReason }, ctx): Promise<{ planId: string }> {
    const proposed = await db.treatmentPlan.findUnique({
      where: { id: proposedPlanId },
      select: {
        id: true,
        patientId: true,
        doctorId: true,
        assignedTherapistId: true,
        status: true,
      },
    });
    if (!proposed) throw new PlanError(notFound);
    if (proposed.status !== PlanStatus.PROPOSED) throw new PlanError(notProposed);
    if (proposed.doctorId !== ctx.doctorId) throw new PlanError(forbidden);

    await db.treatmentPlan.update({
      where: { id: proposed.id },
      data: { status: PlanStatus.REJECTED, rejectedReason },
    });

    const [doctorName, patientName] = await Promise.all([
      fullName(ctx.doctorId),
      fullName(proposed.patientId),
    ]);
    await createNotification({
      recipientId: proposed.assignedTherapistId,
      type: 'PLAN_PROPOSAL_REJECTED',
      params: { doctorName, patientName, reason: rejectedReason },
      linkPath: `/therapist/plans/${proposed.id}`,
      relatedEntityType: 'TreatmentPlan',
      relatedEntityId: proposed.id,
    }).catch((err: unknown) => {
      console.error('[plans] notification PLAN_PROPOSAL_REJECTED failed', err);
    });

    return { planId: proposed.id };
  },
);

// ─── Lifecycle transitions (pause / complete / discontinue) ────────────────
type Transition = 'PAUSED' | 'COMPLETED' | 'DISCONTINUED';

async function transitionInner(
  planId: string,
  to: Transition,
  ctx: { doctorId: string },
): Promise<{ planId: string }> {
  const plan = await db.treatmentPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      status: true,
      doctorId: true,
      patientId: true,
      assignedTherapistId: true,
    },
  });
  if (!plan) throw new PlanError(notFound);
  if (plan.status !== PlanStatus.ACTIVE && plan.status !== PlanStatus.PAUSED) {
    throw new PlanError(notActive);
  }
  if (plan.doctorId !== ctx.doctorId) throw new PlanError(forbidden);

  await db.treatmentPlan.update({
    where: { id: plan.id },
    data: { status: PlanStatus[to] },
  });

  if (to === 'PAUSED' || to === 'DISCONTINUED') {
    const patientName = await fullName(plan.patientId);
    await createNotification({
      recipientId: plan.assignedTherapistId,
      type: to === 'PAUSED' ? 'PLAN_PAUSED' : 'PLAN_DISCONTINUED',
      params: { patientName },
      linkPath: `/therapist/plans/${plan.id}`,
      relatedEntityType: 'TreatmentPlan',
      relatedEntityId: plan.id,
    }).catch((err: unknown) => {
      console.error('[plans] lifecycle notification failed', err);
    });
  }

  return { planId: plan.id };
}

export const pauseTreatmentPlan = withAudit<
  [{ planId: string }, { doctorId: string }],
  { planId: string }
>(
  {
    entityType: 'TreatmentPlan',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].planId,
    extractAfter: () => ({ event: 'PAUSED' }) as Prisma.InputJsonValue,
  },
  async ({ planId }, ctx) => transitionInner(planId, 'PAUSED', ctx),
);

export const completeTreatmentPlan = withAudit<
  [{ planId: string }, { doctorId: string }],
  { planId: string }
>(
  {
    entityType: 'TreatmentPlan',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].planId,
    extractAfter: () => ({ event: 'COMPLETED' }) as Prisma.InputJsonValue,
  },
  async ({ planId }, ctx) => transitionInner(planId, 'COMPLETED', ctx),
);

export const discontinueTreatmentPlan = withAudit<
  [{ planId: string }, { doctorId: string }],
  { planId: string }
>(
  {
    entityType: 'TreatmentPlan',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].planId,
    extractAfter: () => ({ event: 'DISCONTINUED' }) as Prisma.InputJsonValue,
  },
  async ({ planId }, ctx) => transitionInner(planId, 'DISCONTINUED', ctx),
);

export function planToLocalized(err: unknown): LocalizedError {
  if (err instanceof PlanError) return err.error;
  return toLocalizedError(err);
}

/**
 * Resource-scope helper for action-level RBAC checks. Used by the
 * server-action facade to decide whether `can()` should accept the
 * current actor for a given plan.
 */
export interface PlanScopeContext {
  assignedClinicianIds: ReadonlyArray<string>;
  ownerId: string;
}

export async function planScopeContext(planId: string): Promise<PlanScopeContext | null> {
  const p = await db.treatmentPlan.findUnique({
    where: { id: planId },
    select: { doctorId: true, assignedTherapistId: true },
  });
  if (!p) return null;
  return {
    assignedClinicianIds: [p.doctorId, p.assignedTherapistId],
    ownerId: p.doctorId,
  };
}

// Convenience: actor utilities used by the action facade.
export async function currentDoctorId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new PlanError(unauthenticated);
  if (session.user.role !== UserRole.DOCTOR && session.user.role !== UserRole.ADMIN) {
    throw new PlanError(forbidden);
  }
  return session.user.id;
}

export async function currentTherapistId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new PlanError(unauthenticated);
  if (session.user.role !== UserRole.THERAPIST && session.user.role !== UserRole.ADMIN) {
    throw new PlanError(forbidden);
  }
  return session.user.id;
}
