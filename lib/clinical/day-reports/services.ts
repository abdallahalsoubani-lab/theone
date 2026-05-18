import { AuditAction, PlanStatus, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { createNotification } from '@/lib/notifications/actions';

import type { DayReportSubmitInput } from './schemas';

/**
 * Day-report services (Prompt 9 §4.9).
 *
 * One DayReport row per (therapistId, date). Submitting twice on the
 * same date upserts — re-submission is intentional and welcomed within
 * a 48h adjustment window. The notification fan-out collects the
 * responsible doctors of every patient in the entries, dedupes, and
 * sends one DAY_REPORT_SUBMITTED notification per unique doctor.
 */

export class DayReportError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'DayReportError';
  }
}

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};
const forbidden: LocalizedError = {
  code: 'DAY_REPORT_FORBIDDEN',
  message_en: 'Only Therapists or Admins can submit day reports.',
  message_ar: 'يمكن للمعالجين والمدراء فقط تقديم تقارير اليوم.',
};

function parseDate(yyyymmdd: string): Date {
  // Midnight UTC so the @db.Date column round-trips cleanly.
  return new Date(`${yyyymmdd}T00:00:00.000Z`);
}

export const submitDayReport = withAudit<
  [DayReportSubmitInput, { therapistId: string }],
  { reportId: string }
>(
  {
    entityType: 'DayReport',
    action: AuditAction.UPDATE,
    extractEntityId: (_args, result) => result.reportId,
    extractAfter: () => ({ event: 'SUBMITTED' }) as Prisma.InputJsonValue,
  },
  async function submitInner(input, ctx): Promise<{ reportId: string }> {
    const date = parseDate(input.date);
    const row = await db.dayReport.upsert({
      where: { therapistId_date: { therapistId: ctx.therapistId, date } },
      update: {
        overallSummary: input.overallSummary,
        patientEntries: input.patientEntries as unknown as Prisma.InputJsonValue,
        submittedAt: new Date(),
      },
      create: {
        therapistId: ctx.therapistId,
        date,
        overallSummary: input.overallSummary,
        patientEntries: input.patientEntries as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Notify each unique responsible doctor across the entries. We look
    // up via the patient's ACTIVE treatment plan's doctorId — that's the
    // doctor accountable for the patient's current care.
    const patientIds = Array.from(new Set(input.patientEntries.map((e) => e.patientId)));
    if (patientIds.length > 0) {
      const activePlans = await db.treatmentPlan.findMany({
        where: { patientId: { in: patientIds }, status: PlanStatus.ACTIVE },
        select: { patientId: true, doctorId: true },
      });
      const doctorIds = Array.from(new Set(activePlans.map((p) => p.doctorId)));
      const therapistName = await fullName(ctx.therapistId);
      const dateLabel = date.toISOString().slice(0, 10);
      await Promise.all(
        doctorIds.map((doctorId) =>
          createNotification({
            recipientId: doctorId,
            type: 'DAY_REPORT_SUBMITTED',
            params: { therapistName, date: dateLabel },
            linkPath: '/doctor/reports/weekly',
            relatedEntityType: 'DayReport',
            relatedEntityId: row.id,
          }).catch((err: unknown) => {
            console.error('[day-reports] notification fan-out failed', err);
          }),
        ),
      );
    }

    return { reportId: row.id };
  },
);

async function fullName(userId: string): Promise<string> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { fullNameEn: true },
  });
  return u?.fullNameEn ?? '';
}

export function dayReportToLocalized(err: unknown): LocalizedError {
  if (err instanceof DayReportError) return err.error;
  return toLocalizedError(err);
}

export async function currentTherapistOrAdminId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new DayReportError(unauthenticated);
  if (session.user.role !== UserRole.THERAPIST && session.user.role !== UserRole.ADMIN) {
    throw new DayReportError(forbidden);
  }
  return session.user.id;
}
