import { AuditAction, UserRole } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { isClinicianAssignedTo } from '@/lib/patients/assignment';
import { clinicDateKey } from '@/lib/time/clinic';

import { hasSoapContent, type MonthlyReportSaveInput } from './schemas';

/**
 * P64 #11 — the monthly report: the four SOAP fields, ONE per patient per
 * clinic month, written by a therapist on the patient's care team or by a
 * doctor. Saving the month again edits the same row (author or a doctor).
 * Session notes became short per-session RESULTS; the clinical narrative
 * lives here.
 */
export class MonthlyReportError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'MonthlyReportError';
  }
}

export const MONTHLY_REPORT_ERRORS = {
  EMPTY: {
    code: 'MONTHLY_REPORT_EMPTY',
    message_en: 'Fill at least one of the four fields.',
    message_ar: 'املأ حقلاً واحداً على الأقل من الحقول الأربعة.',
  },
  FUTURE: {
    code: 'MONTHLY_REPORT_FUTURE_MONTH',
    message_en: 'A report cannot be written for a future month.',
    message_ar: 'لا يمكن كتابة تقرير لشهر قادم.',
  },
  FORBIDDEN: {
    code: 'MONTHLY_REPORT_FORBIDDEN',
    message_en: "Only the patient's therapist or a doctor can write this report.",
    message_ar: 'كتابة هذا التقرير للمعالج المسؤول عن المراجع أو للطبيب فقط.',
  },
  NOT_AUTHOR: {
    code: 'MONTHLY_REPORT_NOT_AUTHOR',
    message_en:
      "This month's report was written by a colleague — only they or a doctor can edit it.",
    message_ar: 'تقرير هذا الشهر كتبه زميل — يعدّله هو أو الطبيب فقط.',
  },
} satisfies Record<string, LocalizedError>;

export interface MonthlyReportActor {
  id: string;
  role: UserRole;
}

async function assertCanAuthor(actor: MonthlyReportActor, patientId: string): Promise<void> {
  if (actor.role === UserRole.DOCTOR) return;
  if (actor.role === UserRole.THERAPIST && (await isClinicianAssignedTo(actor.id, patientId))) {
    return;
  }
  throw new MonthlyReportError(MONTHLY_REPORT_ERRORS.FORBIDDEN);
}

/** The current clinic month, 'YYYY-MM'. */
export function currentClinicMonth(now: Date = new Date(), timeZone?: string): string {
  return clinicDateKey(now, timeZone).slice(0, 7);
}

type SaveResult = { id: string; created: boolean; month: string; patientId: string };

/**
 * Create-or-edit the patient's report for `month`. One audit row either way
 * (CREATE on first save, UPDATE after) — `withAudit` takes a fixed action,
 * so the two paths are two audited inner functions behind one entry point.
 */
const createReport = withAudit<[MonthlyReportSaveInput, MonthlyReportActor], SaveResult>(
  {
    entityType: 'MonthlyReport',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.id,
    extractAfter: (r) => ({
      event: 'MONTHLY_REPORT_CREATED',
      month: r.month,
      patientId: r.patientId,
    }),
  },
  async function createReportInner(input, actor): Promise<SaveResult> {
    const row = await db.monthlyReport.create({
      data: {
        patientId: input.patientId,
        month: input.month,
        authorId: actor.id,
        subjective: input.subjective?.trim() ?? '',
        objective: input.objective?.trim() ?? '',
        assessment: input.assessment?.trim() ?? '',
        plan: input.plan?.trim() ?? '',
      },
      select: { id: true },
    });
    return { id: row.id, created: true, month: input.month, patientId: input.patientId };
  },
);

const updateReport = withAudit<
  [{ id: string } & MonthlyReportSaveInput, MonthlyReportActor],
  SaveResult
>(
  {
    entityType: 'MonthlyReport',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) =>
      db.monthlyReport.findUnique({
        where: { id: args[0].id },
        select: { subjective: true, objective: true, assessment: true, plan: true },
      }),
    extractAfter: (r) => ({
      event: 'MONTHLY_REPORT_UPDATED',
      month: r.month,
      patientId: r.patientId,
    }),
  },
  async function updateReportInner(input): Promise<SaveResult> {
    await db.monthlyReport.update({
      where: { id: input.id },
      data: {
        subjective: input.subjective?.trim() ?? '',
        objective: input.objective?.trim() ?? '',
        assessment: input.assessment?.trim() ?? '',
        plan: input.plan?.trim() ?? '',
      },
    });
    return { id: input.id, created: false, month: input.month, patientId: input.patientId };
  },
);

export async function saveMonthlyReport(
  input: MonthlyReportSaveInput,
  actor: MonthlyReportActor,
  now: Date = new Date(),
): Promise<SaveResult> {
  if (!hasSoapContent(input)) throw new MonthlyReportError(MONTHLY_REPORT_ERRORS.EMPTY);
  if (input.month > currentClinicMonth(now)) {
    throw new MonthlyReportError(MONTHLY_REPORT_ERRORS.FUTURE);
  }
  await assertCanAuthor(actor, input.patientId);

  const existing = await db.monthlyReport.findUnique({
    where: { patientId_month: { patientId: input.patientId, month: input.month } },
    select: { id: true, authorId: true },
  });
  if (!existing) return createReport(input, actor);
  if (existing.authorId !== actor.id && actor.role !== UserRole.DOCTOR) {
    throw new MonthlyReportError(MONTHLY_REPORT_ERRORS.NOT_AUTHOR);
  }
  return updateReport({ id: existing.id, ...input }, actor);
}

export function monthlyReportToLocalized(err: unknown): LocalizedError {
  if (err instanceof MonthlyReportError) return err.error;
  return toLocalizedError(err);
}
