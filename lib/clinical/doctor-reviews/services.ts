import { AuditAction, PlanStatus, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { createNotification } from '@/lib/notifications/actions';

import type { DoctorReviewCreateInput } from './schemas';

/**
 * Doctor review services (Prompt 9 §4.10).
 *
 * One row per submission. Reviews are immutable; if the Doctor needs
 * to amend, they add a second row for the same (patient, week). Both
 * appear in the timeline.
 */

export class DoctorReviewError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'DoctorReviewError';
  }
}

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};
const forbidden: LocalizedError = {
  code: 'DOCTOR_REVIEW_FORBIDDEN',
  message_en: 'Only Doctors can write reviews.',
  message_ar: 'يمكن للأطباء فقط كتابة المراجعات.',
};

export const createDoctorReview = withAudit<
  [DoctorReviewCreateInput, { doctorId: string }],
  { reviewId: string }
>(
  {
    entityType: 'DoctorReview',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.reviewId,
    extractAfter: () => ({ event: 'CREATED' }) as Prisma.InputJsonValue,
  },
  async function createInner(input, ctx): Promise<{ reviewId: string }> {
    const weekStarting = new Date(`${input.weekStarting}T00:00:00.000Z`);
    const row = await db.doctorReview.create({
      data: {
        doctorId: ctx.doctorId,
        patientId: input.patientId,
        weekStarting,
        comment: input.comment,
      },
      select: { id: true },
    });

    // Notify the patient's assigned therapist (via active plan).
    const activePlan = await db.treatmentPlan.findFirst({
      where: { patientId: input.patientId, status: PlanStatus.ACTIVE },
      select: { assignedTherapistId: true },
    });
    if (activePlan) {
      const [doctorName, patientName] = await Promise.all([
        fullName(ctx.doctorId),
        fullName(input.patientId),
      ]);
      await createNotification({
        recipientId: activePlan.assignedTherapistId,
        type: 'DOCTOR_REVIEW_ADDED',
        params: { doctorName, patientName },
        linkPath: '/therapist/dashboard',
        relatedEntityType: 'DoctorReview',
        relatedEntityId: row.id,
      }).catch((err: unknown) => {
        console.error('[doctor-reviews] notification failed', err);
      });
    }

    return { reviewId: row.id };
  },
);

async function fullName(userId: string): Promise<string> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { fullNameEn: true },
  });
  return u?.fullNameEn ?? '';
}

export function doctorReviewToLocalized(err: unknown): LocalizedError {
  if (err instanceof DoctorReviewError) return err.error;
  return toLocalizedError(err);
}

export async function currentDoctorId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new DoctorReviewError(unauthenticated);
  if (session.user.role !== UserRole.DOCTOR && session.user.role !== UserRole.ADMIN) {
    throw new DoctorReviewError(forbidden);
  }
  return session.user.id;
}
