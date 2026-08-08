import { AuditAction, HomeProgramStatus, type Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, type LocalizedError } from '@/lib/db';
import { createNotification } from '@/lib/notifications/actions';
import { getCareTeam } from '@/lib/patients/assignment';

import { listHomeProgramForPatient } from './queries';
import { getApprovalState } from './visibility';

export { getApprovalState } from './visibility';
export type { ApprovalState } from './visibility';

/**
 * Home-program approval workflow (Prompt 16, revised by QA 7.8).
 *
 * State machine (per patient, on HomeProgramApproval):
 *   DRAFT ──submit──▶ PENDING_APPROVAL ──approve──▶ APPROVED
 *                          ▲   │ request_changes
 *                          │   ▼
 *                          └ CHANGES_REQUESTED ──(therapist edits + submit)
 *
 * Auto-transitions on a clinical edit (see onHomeProgramEdited):
 *   - Doctor/Admin edit  → APPROVED (re-snapshot). The doctor IS the approver.
 *   - Therapist edit of an APPROVED program → back to DRAFT (a reopened
 *     working revision — nothing is auto-submitted, no doctor notification).
 *     The patient keeps seeing the frozen `approvedSnapshot` until the
 *     therapist explicitly submits AND the doctor re-approves.
 *   - Therapist edit in DRAFT / PENDING_APPROVAL / CHANGES_REQUESTED keeps
 *     the current status; the therapist submits (or resubmits) explicitly.
 *
 * Submitting is only valid from DRAFT / CHANGES_REQUESTED — submitHomeProgram
 * enforces that server-side (the panel hides the button for other states).
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

const alreadySubmitted: LocalizedError = {
  code: 'HOME_PROGRAM_ALREADY_SUBMITTED',
  message_en:
    'This home program is already awaiting approval or approved. Edit the program to open a new draft revision before submitting.',
  message_ar:
    'هذا البرنامج المنزلي بانتظار الموافقة أو تمت الموافقة عليه بالفعل. عدّل البرنامج لفتح مسودة مراجعة جديدة قبل الإرسال.',
};

// The approved-program READ lives in ./visible so read-only surfaces (patient
// portal, patient-file tab, PDF export) don't pull this module's write-side
// graph (@/auth, notifications, withAudit) — importing it into the PDF route
// broke that module's test environment on next-auth's edge `next/server`.
// Re-exported here because this is where callers have always looked for it.
export { getVisibleHomeProgram, getVisibleTodayItems } from './visible';

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
 * Therapist EXPLICITLY submits the program for review (DRAFT /
 * CHANGES_REQUESTED → PENDING_APPROVAL). Rejects any other from-state — an
 * already-pending or approved program has nothing new to submit (QA 7.8).
 * Notifies the care-team doctors.
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
    const current = await db.homeProgramApproval.findUnique({
      where: { patientId },
      select: { status: true },
    });
    if (
      current &&
      (current.status === HomeProgramStatus.PENDING_APPROVAL ||
        current.status === HomeProgramStatus.APPROVED)
    ) {
      throw new HomeProgramApprovalError(alreadySubmitted);
    }
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
 * Reopen an APPROVED program as a working DRAFT after a therapist edit
 * (QA 7.8). Nothing is submitted and no doctor is notified — the therapist
 * keeps editing and submits explicitly when done. The frozen
 * `approvedSnapshot` is preserved so the patient (and the reminder worker)
 * keep seeing the last approved content.
 *
 * Backfill guard: rows approved by the 20260612100000 migration backfill
 * carry a NULL `approvedSnapshot` — for those we freeze the current live
 * items first, otherwise leaving APPROVED would blank the patient's program.
 */
export const reopenHomeProgramDraft = withAudit<
  [string],
  { patientId: string; status: HomeProgramStatus }
>(
  {
    entityType: 'HomeProgramApproval',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'HOME_PROGRAM_REOPENED_DRAFT', status: 'DRAFT' }),
  },
  async function reopenInner(patientId): Promise<{ patientId: string; status: HomeProgramStatus }> {
    const row = await db.homeProgramApproval.findUnique({
      where: { patientId },
      select: { approvedSnapshot: true },
    });
    const snapshotPatch =
      row && row.approvedSnapshot === null
        ? { approvedSnapshot: await buildSnapshot(patientId) }
        : {};
    await db.homeProgramApproval.upsert({
      where: { patientId },
      update: {
        status: HomeProgramStatus.DRAFT,
        submittedById: null,
        submittedAt: null,
        ...snapshotPatch,
      },
      create: { patientId, status: HomeProgramStatus.DRAFT },
    });
    return { patientId, status: HomeProgramStatus.DRAFT };
  },
);

/**
 * Approve the program (→ APPROVED) and freeze the current live items into the
 * snapshot. Used by the doctor's explicit approve AND the auto-approve when a
 * doctor/admin edits. Notifies the therapist who submitted (if any) — the
 * auto-approve path passes `notifySubmitter: false` and sends the accurate
 * "doctor edited your program" notification instead (NI-6, Prompt 43).
 */
export const approveHomeProgram = withAudit<
  [string, { notifySubmitter?: boolean }?],
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
    opts?: { notifySubmitter?: boolean },
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
    const notifySubmitter = opts?.notifySubmitter ?? true;
    if (notifySubmitter && before?.submittedById && before.submittedById !== reviewerId) {
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
 * program → back to DRAFT (reopened revision, preserving the approved
 * snapshot — the therapist submits explicitly, QA 7.8). A therapist editing a
 * DRAFT/PENDING/CHANGES program just keeps building (status unchanged); a
 * DRAFT row is ensured so the builder shows a status.
 */
export async function onHomeProgramEdited(patientId: string): Promise<void> {
  const session = await auth();
  const role = session?.user?.role;
  if (role === 'DOCTOR' || role === 'ADMIN') {
    // Capture the submitter BEFORE the approve upsert (which keeps it, but
    // being explicit here decouples the two).
    const before = await db.homeProgramApproval.findUnique({
      where: { patientId },
      select: { submittedById: true },
    });
    // The generic "approved" notification would mislabel an edit (and repeat
    // per item change) — suppressed in favour of the accurate one (NI-6).
    await approveHomeProgram(patientId, { notifySubmitter: false });
    await notifyTherapistsOfDoctorEdit(
      patientId,
      session?.user?.id ?? null,
      before?.submittedById ?? null,
    );
    return;
  }
  if (role === 'THERAPIST') {
    const state = await getApprovalState(patientId);
    if (state.status === HomeProgramStatus.APPROVED) {
      await reopenHomeProgramDraft(patientId);
    } else {
      await db.homeProgramApproval.upsert({
        where: { patientId },
        update: {},
        create: { patientId, status: HomeProgramStatus.DRAFT },
      });
    }
  }
}

/**
 * NI-6 (Prompt 43): a doctor/admin edited the program → tell the therapist.
 * Recipients: the therapist who submitted the program when known, otherwise
 * every THERAPIST on the patient's care team (doctor-built or reopened
 * programs have no submitter). The editor never notifies themself.
 *
 * Deduped on UNREAD: a doctor editing five items in one sitting produces one
 * notification, not five — a new one only fires after the therapist read the
 * previous one.
 */
async function notifyTherapistsOfDoctorEdit(
  patientId: string,
  editorId: string | null,
  submittedById: string | null,
): Promise<void> {
  const recipients = submittedById
    ? [submittedById]
    : (await getCareTeam(patientId)).therapists.map((t) => t.id);
  const targets = [...new Set(recipients)].filter((id) => id && id !== editorId);
  if (targets.length === 0) return;
  const [doctorName, patientName] = await Promise.all([
    editorId ? fullName(editorId) : Promise.resolve(''),
    fullName(patientId),
  ]);
  await Promise.all(
    targets.map(async (recipientId) => {
      try {
        const unread = await db.notification.findFirst({
          where: {
            recipientId,
            type: 'HOME_PROGRAM_DOCTOR_EDITED',
            relatedEntityId: patientId,
            readAt: null,
          },
          select: { id: true },
        });
        if (unread) return;
        await createNotification({
          recipientId,
          type: 'HOME_PROGRAM_DOCTOR_EDITED',
          params: { doctorName, patientName },
          linkPath: `/therapist/patients/${patientId}/home-program/edit`,
          relatedEntityType: 'HomeProgramApproval',
          relatedEntityId: patientId,
        });
      } catch (err: unknown) {
        console.error('[home-program] doctor-edit notification failed', err);
      }
    }),
  );
}

/**
 * Pending review count for the doctor's sidebar badge (NI-7, Prompt 43) —
 * same scope as `listPendingApprovals` (care-team for a doctor, all for
 * Admin), count only.
 */
export async function countPendingApprovals(careTeamDoctorId: string | null): Promise<number> {
  return db.homeProgramApproval.count({
    where: {
      status: HomeProgramStatus.PENDING_APPROVAL,
      ...(careTeamDoctorId
        ? { patient: { patientProfile: { careTeam: { some: { clinicianId: careTeamDoctorId } } } } }
        : {}),
    },
  });
}

export function homeProgramApprovalToLocalized(err: unknown): LocalizedError | null {
  if (err instanceof HomeProgramApprovalError) return err.error;
  return null;
}
