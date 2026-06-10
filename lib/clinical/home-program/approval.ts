import { AuditAction, HomeProgramStatus, type Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, type LocalizedError } from '@/lib/db';
import { createNotification } from '@/lib/notifications/actions';
import { getCareTeam } from '@/lib/patients/assignment';

import { listHomeProgramForPatient, type HomeProgramItemRow } from './queries';
import { getApprovalState, parseSnapshot } from './visibility';

export { getApprovalState } from './visibility';
export type { ApprovalState } from './visibility';

/**
 * Home-program approval workflow (Prompt 16).
 *
 * State machine (per patient, on HomeProgramApproval):
 *   DRAFT ──submit──▶ PENDING_APPROVAL ──approve──▶ APPROVED
 *                          ▲   │ request_changes
 *                          │   ▼
 *                          └ CHANGES_REQUESTED ──(therapist edits + submit)
 *
 * Auto-transitions on a clinical edit (see onHomeProgramEdited):
 *   - Doctor/Admin edit  → APPROVED (re-snapshot). The doctor IS the approver.
 *   - Therapist edit of an APPROVED program → PENDING_APPROVAL. The patient
 *     keeps seeing the frozen `approvedSnapshot` until re-approval.
 *
 * Permission + care-team checks live in the action layer; these services
 * assume the caller is authorized and just move the state (audited).
 */

export class HomeProgramApprovalError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'HomeProgramApprovalError';
  }
}

const commentRequired: LocalizedError = {
  code: 'HOME_PROGRAM_COMMENT_REQUIRED',
  message_en: 'A comment is required when requesting changes.',
  message_ar: 'التعليق مطلوب عند طلب التعديلات.',
};

/**
 * THE patient-facing read (data-layer guarantee, Prompt 16). Returns the
 * APPROVED content only: the live items when the program is APPROVED, otherwise
 * the frozen `approvedSnapshot` (the last approved content), or nothing if the
 * program was never approved. Used by the patient portal, the reminder worker,
 * and the compliance check — never the raw `listHomeProgramForPatient` (which
 * is the clinicians' working draft).
 */
export async function getVisibleHomeProgram(patientId: string): Promise<HomeProgramItemRow[]> {
  const row = await db.homeProgramApproval.findUnique({
    where: { patientId },
    select: { status: true, approvedSnapshot: true },
  });
  if (!row) return [];
  if (row.status === HomeProgramStatus.APPROVED) return listHomeProgramForPatient(patientId);
  return parseSnapshot(row.approvedSnapshot);
}

/** Visible (approved) items scheduled for today. */
export async function getVisibleTodayItems(
  patientId: string,
  now: Date = new Date(),
): Promise<HomeProgramItemRow[]> {
  const dow = new Date(now).getUTCDay();
  const items = await getVisibleHomeProgram(patientId);
  return items.filter((i) => i.active && i.daysOfWeek.includes(dow));
}

export interface PendingApprovalRow {
  patientId: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  therapistFullNameEn: string | null;
  therapistFullNameAr: string | null;
  submittedAt: Date | null;
  itemCount: number;
}

/**
 * Pending home-program approvals for the doctor review queue. A doctor sees
 * only patients on their care team; pass `null` (Admin) to see all.
 */
export async function listPendingApprovals(
  careTeamDoctorId: string | null,
): Promise<PendingApprovalRow[]> {
  const rows = await db.homeProgramApproval.findMany({
    where: {
      status: HomeProgramStatus.PENDING_APPROVAL,
      ...(careTeamDoctorId
        ? { patient: { patientProfile: { careTeam: { some: { clinicianId: careTeamDoctorId } } } } }
        : {}),
    },
    select: {
      patientId: true,
      submittedAt: true,
      patient: { select: { fullNameEn: true, fullNameAr: true } },
      submittedBy: { select: { fullNameEn: true, fullNameAr: true } },
    },
    orderBy: { submittedAt: 'asc' },
  });
  // Count current (draft) items per patient for a quick reviewer signal.
  const counts = await db.homeProgramItem.groupBy({
    by: ['patientId'],
    where: { patientId: { in: rows.map((r) => r.patientId) }, active: true },
    _count: { _all: true },
  });
  const countByPatient = new Map(counts.map((c) => [c.patientId, c._count._all]));
  return rows.map((r) => ({
    patientId: r.patientId,
    patientFullNameEn: r.patient.fullNameEn,
    patientFullNameAr: r.patient.fullNameAr,
    therapistFullNameEn: r.submittedBy?.fullNameEn ?? null,
    therapistFullNameAr: r.submittedBy?.fullNameAr ?? null,
    submittedAt: r.submittedAt,
    itemCount: countByPatient.get(r.patientId) ?? 0,
  }));
}

async function fullName(userId: string): Promise<string> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { fullNameEn: true } });
  return u?.fullNameEn ?? '';
}

/** Frozen, denormalized copy of the current live program — what the patient
 *  keeps seeing while a revision is pending. Dates are stored as ISO strings. */
async function buildSnapshot(patientId: string): Promise<Prisma.InputJsonValue> {
  const items = await listHomeProgramForPatient(patientId);
  return items.map((i) => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
  })) as unknown as Prisma.InputJsonValue;
}

async function notifyCareTeamDoctors(patientId: string, therapistName: string): Promise<void> {
  const { doctors } = await getCareTeam(patientId);
  const patientName = await fullName(patientId);
  await Promise.all(
    doctors.map((d) =>
      createNotification({
        recipientId: d.id,
        type: 'HOME_PROGRAM_SUBMITTED',
        params: { therapistName, patientName },
        linkPath: '/doctor/approvals',
        relatedEntityType: 'HomeProgramApproval',
        relatedEntityId: patientId,
      }).catch((err: unknown) => {
        console.error('[home-program] submit notification failed', err);
      }),
    ),
  );
}

/**
 * Therapist submits the program for review (DRAFT / CHANGES_REQUESTED →
 * PENDING_APPROVAL). Also the auto-transition when a therapist edits an
 * APPROVED program. Notifies the care-team doctors.
 */
export const submitHomeProgram = withAudit<
  [string],
  { patientId: string; status: HomeProgramStatus }
>(
  {
    entityType: 'HomeProgramApproval',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'HOME_PROGRAM_SUBMITTED', status: 'PENDING_APPROVAL' }),
  },
  async function submitInner(patientId): Promise<{ patientId: string; status: HomeProgramStatus }> {
    const session = await auth();
    const actorId = session?.user?.id ?? null;
    await db.homeProgramApproval.upsert({
      where: { patientId },
      update: {
        status: HomeProgramStatus.PENDING_APPROVAL,
        submittedById: actorId,
        submittedAt: new Date(),
      },
      create: {
        patientId,
        status: HomeProgramStatus.PENDING_APPROVAL,
        submittedById: actorId,
        submittedAt: new Date(),
      },
    });
    await notifyCareTeamDoctors(patientId, actorId ? await fullName(actorId) : '');
    return { patientId, status: HomeProgramStatus.PENDING_APPROVAL };
  },
);

/**
 * Approve the program (→ APPROVED) and freeze the current live items into the
 * snapshot. Used by the doctor's explicit approve AND the auto-approve when a
 * doctor/admin edits. Notifies the therapist who submitted (if any).
 */
export const approveHomeProgram = withAudit<
  [string],
  { patientId: string; status: HomeProgramStatus }
>(
  {
    entityType: 'HomeProgramApproval',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'HOME_PROGRAM_APPROVED', status: 'APPROVED' }),
  },
  async function approveInner(
    patientId,
  ): Promise<{ patientId: string; status: HomeProgramStatus }> {
    const session = await auth();
    const reviewerId = session?.user?.id ?? null;
    const snapshot = await buildSnapshot(patientId);
    const before = await db.homeProgramApproval.findUnique({
      where: { patientId },
      select: { submittedById: true },
    });
    await db.homeProgramApproval.upsert({
      where: { patientId },
      update: {
        status: HomeProgramStatus.APPROVED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        approvedAt: new Date(),
        approvedSnapshot: snapshot,
        changesComment: null,
      },
      create: {
        patientId,
        status: HomeProgramStatus.APPROVED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        approvedAt: new Date(),
        approvedSnapshot: snapshot,
      },
    });
    // Notify the therapist who submitted (skip for doctor-built programs).
    if (before?.submittedById && before.submittedById !== reviewerId) {
      await createNotification({
        recipientId: before.submittedById,
        type: 'HOME_PROGRAM_APPROVED',
        params: {
          doctorName: reviewerId ? await fullName(reviewerId) : '',
          patientName: await fullName(patientId),
        },
        linkPath: `/therapist/patients/${patientId}/home-program/edit`,
        relatedEntityType: 'HomeProgramApproval',
        relatedEntityId: patientId,
      }).catch((err: unknown) => console.error('[home-program] approve notification failed', err));
    }
    return { patientId, status: HomeProgramStatus.APPROVED };
  },
);

/** Doctor requests changes (→ CHANGES_REQUESTED) with a required comment. */
export const requestHomeProgramChanges = withAudit<
  [string, string],
  { patientId: string; status: HomeProgramStatus }
>(
  {
    entityType: 'HomeProgramApproval',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'HOME_PROGRAM_CHANGES_REQUESTED', status: 'CHANGES_REQUESTED' }),
  },
  async function requestChangesInner(
    patientId,
    comment,
  ): Promise<{ patientId: string; status: HomeProgramStatus }> {
    const trimmed = comment.trim();
    if (!trimmed) throw new HomeProgramApprovalError(commentRequired);
    const session = await auth();
    const reviewerId = session?.user?.id ?? null;
    const before = await db.homeProgramApproval.update({
      where: { patientId },
      data: {
        status: HomeProgramStatus.CHANGES_REQUESTED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        changesComment: trimmed,
      },
      select: { submittedById: true },
    });
    if (before.submittedById) {
      await createNotification({
        recipientId: before.submittedById,
        type: 'HOME_PROGRAM_CHANGES_REQUESTED',
        params: {
          doctorName: reviewerId ? await fullName(reviewerId) : '',
          patientName: await fullName(patientId),
        },
        linkPath: `/therapist/patients/${patientId}/home-program/edit`,
        relatedEntityType: 'HomeProgramApproval',
        relatedEntityId: patientId,
      }).catch((err: unknown) => console.error('[home-program] changes notification failed', err));
    }
    return { patientId, status: HomeProgramStatus.CHANGES_REQUESTED };
  },
);

/**
 * Toggle WhatsApp reminder delivery — a preference, NOT clinical content, so it
 * does NOT change the approval status. Audited.
 */
export const setHomeProgramReminders = withAudit<
  [string, boolean],
  { patientId: string; remindersEnabled: boolean }
>(
  {
    entityType: 'HomeProgramApproval',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: (result) => ({
      event: 'HOME_PROGRAM_REMINDERS_TOGGLED',
      remindersEnabled: result.remindersEnabled,
    }),
  },
  async function setRemindersInner(
    patientId,
    enabled,
  ): Promise<{ patientId: string; remindersEnabled: boolean }> {
    await db.homeProgramApproval.upsert({
      where: { patientId },
      update: { remindersEnabled: enabled },
      create: { patientId, remindersEnabled: enabled },
    });
    return { patientId, remindersEnabled: enabled };
  },
);

/**
 * Called after any clinical edit to a patient's program items. Drives the
 * auto-transitions: doctor/admin → auto-approve; therapist editing an APPROVED
 * program → back to PENDING_APPROVAL (preserving the approved snapshot). A
 * therapist editing a DRAFT/CHANGES program just keeps building (status
 * unchanged); a DRAFT row is ensured so the builder shows a status.
 */
export async function onHomeProgramEdited(patientId: string): Promise<void> {
  const session = await auth();
  const role = session?.user?.role;
  if (role === 'DOCTOR' || role === 'ADMIN') {
    await approveHomeProgram(patientId);
    return;
  }
  if (role === 'THERAPIST') {
    const state = await getApprovalState(patientId);
    if (state.status === HomeProgramStatus.APPROVED) {
      await submitHomeProgram(patientId);
    } else {
      await db.homeProgramApproval.upsert({
        where: { patientId },
        update: {},
        create: { patientId, status: HomeProgramStatus.DRAFT },
      });
    }
  }
}

export function homeProgramApprovalToLocalized(err: unknown): LocalizedError | null {
  if (err instanceof HomeProgramApprovalError) return err.error;
  return null;
}
