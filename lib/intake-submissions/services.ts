import { AuditAction, IntakeType } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';
import { normalizeJordanPhone } from '@/lib/format/phone';
import { createAdultIntake, createPediatricIntake } from '@/lib/intake/services';
import { adultIntakeSchema, pediatricIntakeSchema } from '@/lib/intake/schemas';
import { createPatient } from '@/lib/patients/services';
import { patientCreateSchema, type PatientCreateInput } from '@/lib/patients/schemas';

import { IntakeSubmissionError, SUBMISSION_ERRORS } from './errors';
import type { PublicSubmissionInput } from './schemas';

/**
 * Create a PENDING submission from the public form (Prompt 23 §4).
 *
 * Deliberately NOT wrapped with `withAudit`: the submitter is anonymous (no
 * actor to attribute), and the row itself IS the durable record. Every
 * REVIEW action below (approve/link/reject) is fully audited.
 *
 * Write-only: this never reads or returns patient data. Phone is normalised to
 * Jordan E.164 here; an unparseable number is rejected before any write.
 */
export async function createPublicSubmission(
  input: PublicSubmissionInput,
): Promise<{ submissionId: string }> {
  const normalized = normalizeJordanPhone(input.profile.phone);
  if (!normalized) throw new IntakeSubmissionError(SUBMISSION_ERRORS.INVALID_PHONE);

  const languagePref = input.locale === 'ar' ? 'AR' : 'EN';
  const profile = {
    fullName: input.profile.fullName,
    phone: normalized,
    dateOfBirth: input.profile.dateOfBirth,
    gender: input.profile.gender,
    address: input.profile.address,
    email: input.profile.email || null,
    languagePref,
  };

  const row = await db.intakeSubmission.create({
    data: {
      type: input.type === 'ADULT' ? IntakeType.ADULT : IntakeType.PEDIATRIC,
      answers: input.answers as unknown as Prisma.InputJsonValue,
      profile: profile as unknown as Prisma.InputJsonValue,
      submittedName: input.profile.fullName,
      submittedPhone: normalized,
      // status defaults to PENDING
    },
    select: { id: true },
  });
  return { submissionId: row.id };
}

/** Build the patient-create input from a stored submission profile. */
function patientInputFromProfile(profile: Record<string, unknown>): PatientCreateInput {
  const fullName = String(profile.fullName ?? '');
  return patientCreateSchema.parse({
    fullNameEn: fullName,
    fullNameAr: fullName,
    phone: String(profile.phone ?? ''),
    email: profile.email ? String(profile.email) : '',
    dateOfBirth: String(profile.dateOfBirth ?? ''),
    gender: profile.gender,
    address: String(profile.address ?? ''),
    languagePref: profile.languagePref === 'EN' ? 'EN' : 'AR',
    hijriCalendarPref: false,
  });
}

/** Attach the stored answers to a patient via the existing intake services. */
async function attachIntake(
  type: IntakeType,
  patientId: string,
  answers: Record<string, unknown>,
): Promise<void> {
  if (type === IntakeType.ADULT) {
    await createAdultIntake({ patientId, data: adultIntakeSchema.parse(answers) });
  } else {
    await createPediatricIntake({ patientId, data: pediatricIntakeSchema.parse(answers) });
  }
}

/** Atomically claim a PENDING submission, or throw ALREADY_REVIEWED. */
async function claimPending(
  submissionId: string,
  actorId: string,
  toStatus: 'APPROVED' | 'REJECTED',
  extra: Prisma.IntakeSubmissionUpdateManyMutationInput = {},
): Promise<void> {
  const claimed = await db.intakeSubmission.updateMany({
    where: { id: submissionId, status: 'PENDING' },
    data: { status: toStatus, reviewedById: actorId, reviewedAt: new Date(), ...extra },
  });
  if (claimed.count === 0) throw new IntakeSubmissionError(SUBMISSION_ERRORS.ALREADY_REVIEWED);
}

/** Release a claim back to PENDING when post-claim work fails. */
async function releaseClaim(submissionId: string): Promise<void> {
  await db.intakeSubmission.updateMany({
    where: { id: submissionId, status: 'APPROVED', linkedPatientId: null },
    data: { status: 'PENDING', reviewedById: null, reviewedAt: null },
  });
}

interface ApproveResult {
  submissionId: string;
  patientId: string;
  mode: 'NEW' | 'LINK';
}

/**
 * Approve → create a NEW patient (Prompt 23 §4). Race-safe: the PENDING→
 * APPROVED claim is atomic, so a concurrent double-approve resolves to exactly
 * one winner; the partial-unique phone index is a second backstop. On any
 * failure after the claim the submission is released back to PENDING.
 */
export const approveSubmissionNew = withAudit<[{ submissionId: string }], ApproveResult>(
  {
    entityType: 'IntakeSubmission',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].submissionId,
    extractAfter: (result) => ({
      event: 'INTAKE_SUBMISSION_APPROVED_NEW',
      patientId: result.patientId,
    }),
  },
  async function approveNewInner({ submissionId }): Promise<ApproveResult> {
    const session = await auth();
    if (!session?.user?.id) throw new IntakeSubmissionError(SUBMISSION_ERRORS.UNAUTHENTICATED);
    const actorId = session.user.id;

    const sub = await db.intakeSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, type: true, status: true, profile: true, answers: true },
    });
    if (!sub) throw new IntakeSubmissionError(SUBMISSION_ERRORS.NOT_FOUND);
    if (sub.status !== 'PENDING') {
      throw new IntakeSubmissionError(SUBMISSION_ERRORS.ALREADY_REVIEWED);
    }

    await claimPending(submissionId, actorId, 'APPROVED');
    try {
      const patientInput = patientInputFromProfile(sub.profile as Record<string, unknown>);
      const created = await createPatient(patientInput, actorId);
      await attachIntake(sub.type, created.patientId, sub.answers as Record<string, unknown>);
      await db.intakeSubmission.update({
        where: { id: submissionId },
        data: { linkedPatientId: created.patientId },
      });
      return { submissionId, patientId: created.patientId, mode: 'NEW' };
    } catch (err) {
      await releaseClaim(submissionId);
      throw err;
    }
  },
);

/**
 * Approve → LINK to an existing patient (duplicate phone). Attaches the intake
 * to the matched patient; no duplicate patient is created. The target must be
 * a non-deleted PATIENT whose phone equals the submitted phone.
 */
export const approveSubmissionLink = withAudit<
  [{ submissionId: string; patientId: string }],
  ApproveResult
>(
  {
    entityType: 'IntakeSubmission',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].submissionId,
    extractAfter: (result) => ({
      event: 'INTAKE_SUBMISSION_APPROVED_LINK',
      patientId: result.patientId,
    }),
  },
  async function approveLinkInner({ submissionId, patientId }): Promise<ApproveResult> {
    const session = await auth();
    if (!session?.user?.id) throw new IntakeSubmissionError(SUBMISSION_ERRORS.UNAUTHENTICATED);
    const actorId = session.user.id;

    const sub = await db.intakeSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, type: true, status: true, submittedPhone: true, answers: true },
    });
    if (!sub) throw new IntakeSubmissionError(SUBMISSION_ERRORS.NOT_FOUND);
    if (sub.status !== 'PENDING') {
      throw new IntakeSubmissionError(SUBMISSION_ERRORS.ALREADY_REVIEWED);
    }

    const target = await db.user.findFirst({
      where: { id: patientId, role: 'PATIENT', deletedAt: null },
      select: { id: true, phone: true },
    });
    if (!target || target.phone !== sub.submittedPhone) {
      throw new IntakeSubmissionError(SUBMISSION_ERRORS.LINK_TARGET_INVALID);
    }

    await claimPending(submissionId, actorId, 'APPROVED');
    try {
      await attachIntake(sub.type, target.id, sub.answers as Record<string, unknown>);
      await db.intakeSubmission.update({
        where: { id: submissionId },
        data: { linkedPatientId: target.id },
      });
      return { submissionId, patientId: target.id, mode: 'LINK' };
    } catch (err) {
      await releaseClaim(submissionId);
      throw err;
    }
  },
);

/** Reject → no patient created; the item leaves the pending queue. */
export const rejectSubmission = withAudit<
  [{ submissionId: string; reason?: string }],
  { submissionId: string }
>(
  {
    entityType: 'IntakeSubmission',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].submissionId,
    extractAfter: () => ({ event: 'INTAKE_SUBMISSION_REJECTED' }),
  },
  async function rejectInner({ submissionId, reason }): Promise<{ submissionId: string }> {
    const session = await auth();
    if (!session?.user?.id) throw new IntakeSubmissionError(SUBMISSION_ERRORS.UNAUTHENTICATED);

    await claimPending(submissionId, session.user.id, 'REJECTED', {
      rejectionReason: reason && reason.trim() ? reason.trim() : null,
    });
    return { submissionId };
  },
);
