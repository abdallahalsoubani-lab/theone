import { AuditAction } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { getPlanById } from '@/lib/clinical/plans/queries';
import { toLocalizedError, type LocalizedError } from '@/lib/db';

import { ReportDocument, renderReportToBuffer, type ReportSection } from './reportLayout';

/**
 * Treatment plan PDF (Prompt 22 §2). Renders an approved/active or proposed
 * plan — diagnosis, goals, dosage, exercise list — for a clinician download.
 *
 * Privacy: the source `PlanCardRow` carries patient/doctor/therapist NAMES but
 * no phone. A clinician-downloaded report must never leak contact PII (enforced
 * by a regression test).
 */

export class TreatmentPlanExportError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'TreatmentPlanExportError';
  }
}

const NOT_FOUND: LocalizedError = {
  code: 'TREATMENT_PLAN_NOT_FOUND',
  message_en: 'This treatment plan no longer exists.',
  message_ar: 'لم تعد خطة العلاج هذه موجودة.',
};

export function treatmentPlanErrorToLocalized(err: unknown): LocalizedError {
  if (err instanceof TreatmentPlanExportError) return err.error;
  return toLocalizedError(err);
}

interface Args {
  planId: string;
  locale: 'en' | 'ar';
}

const generateInner = async ({
  planId,
  locale,
}: Args): Promise<{ buffer: Buffer; patientId: string }> => {
  const ar = locale === 'ar';
  const plan = await getPlanById(planId);
  if (!plan) throw new TreatmentPlanExportError(NOT_FOUND);

  const patientName = ar ? plan.patientFullNameAr : plan.patientFullNameEn;
  const doctorName = ar ? plan.doctorFullNameAr : plan.doctorFullNameEn;
  const therapistName = ar ? plan.therapistFullNameAr : plan.therapistFullNameEn;

  const meta = [
    `${ar ? 'المراجع' : 'Patient'}: ${patientName}`,
    `${ar ? 'النسخة' : 'Version'}: ${plan.version}`,
    `${ar ? 'التاريخ' : 'Date'}: ${plan.createdAt.toISOString().slice(0, 10)}`,
  ].join('  ·  ');

  const sections: ReportSection[] = [
    {
      heading: ar ? 'تفاصيل الخطة' : 'Plan details',
      rows: [
        { label: ar ? 'الحالة' : 'Status', value: plan.status },
        { label: ar ? 'الطبيب' : 'Doctor', value: doctorName },
        { label: ar ? 'المعالج' : 'Therapist', value: therapistName },
        {
          label: ar ? 'التكرار' : 'Frequency',
          value: ar
            ? `${plan.frequencyPerWeek} مرات/أسبوع لمدة ${plan.durationWeeks} أسابيع`
            : `${plan.frequencyPerWeek}×/week for ${plan.durationWeeks} weeks`,
        },
      ],
    },
    {
      heading: ar ? 'التشخيص' : 'Diagnosis',
      rows: [
        { label: ar ? 'أساسي' : 'Primary', value: plan.diagnosisPrimary },
        { label: ar ? 'ثانوي' : 'Secondary', value: plan.diagnosisSecondary || '—' },
      ],
    },
    {
      heading: ar ? 'الأهداف' : 'Goals',
      rows: [
        { label: ar ? 'قصيرة المدى' : 'Short-term', value: plan.goalsShortTerm },
        { label: ar ? 'طويلة المدى' : 'Long-term', value: plan.goalsLongTerm },
      ],
    },
    {
      heading: ar ? 'التمارين' : 'Exercises',
      rows:
        plan.exercises.length > 0
          ? plan.exercises.map((e) => ({
              label: ar ? e.exerciseNameAr : e.exerciseNameEn,
              value: ar
                ? `${e.sets} مجموعات × ${e.reps} تكرار${e.durationSeconds ? ` · ${e.durationSeconds} ث` : ''}${e.customNotes ? ` — ${e.customNotes}` : ''}`
                : `${e.sets} sets × ${e.reps} reps${e.durationSeconds ? ` · ${e.durationSeconds}s` : ''}${e.customNotes ? ` — ${e.customNotes}` : ''}`,
            }))
          : [{ label: '', value: ar ? 'لا توجد تمارين' : 'No exercises' }],
    },
  ];

  if (plan.therapistNotes) {
    sections.push({
      heading: ar ? 'ملاحظات المعالج' : 'Therapist notes',
      body: plan.therapistNotes,
    });
  }

  const title = ar ? 'خطة العلاج' : 'Treatment plan';
  const buffer = await renderReportToBuffer(
    <ReportDocument ar={ar} title={title} meta={meta} sections={sections} />,
  );
  return { buffer, patientId: plan.patientId };
};

export const generateTreatmentPlanPdf = withAudit<[Args], { buffer: Buffer; patientId: string }>(
  {
    entityType: 'TreatmentPlan',
    action: AuditAction.READ_SENSITIVE,
    extractEntityId: (_args, result) => result.patientId,
    extractAfter: () => ({ event: 'TREATMENT_PLAN_EXPORTED' }),
  },
  generateInner,
);
