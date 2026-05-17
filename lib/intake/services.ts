import {
  AuditAction,
  CustomQuestionAppliesTo,
  CustomQuestionType,
  IntakeStatus,
  IntakeType,
} from '@prisma/client';

import { auth } from '@/auth';
import { listCustomQuestions } from '@/lib/admin/custom-questions/queries';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';

import type { AdultIntakeInput, PediatricIntakeInput } from './schemas';

export class IntakeError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'IntakeError';
  }
}

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};

const patientNotFound: LocalizedError = {
  code: 'PATIENT_NOT_FOUND',
  message_en: 'Patient not found.',
  message_ar: 'لم يتم العثور على المراجع.',
};

/**
 * Convert a customAnswers map (`{ questionId: value }`) into the rows shape
 * the IntakeCustomAnswer table expects. For SELECT types we store the option
 * values (not labels) under `valueOptions` so renaming a label later does
 * not orphan the answer. Everything else lands in `value` as a string.
 */
async function buildAnswerRows(
  customAnswers: Record<string, unknown>,
  appliesTo: 'ADULT' | 'PEDIATRIC',
) {
  if (Object.keys(customAnswers).length === 0) return [];
  const questions = await listCustomQuestions({
    scope:
      appliesTo === 'ADULT' ? CustomQuestionAppliesTo.ADULT : CustomQuestionAppliesTo.PEDIATRIC,
  });
  const byId = new Map(questions.map((q) => [q.id, q]));

  const rows: Array<{
    questionId: string;
    value: string | null;
    valueOptions: unknown;
  }> = [];
  for (const [questionId, raw] of Object.entries(customAnswers)) {
    const q = byId.get(questionId);
    if (!q || !q.active) continue;
    if (raw === undefined || raw === null || raw === '') continue;

    if (q.type === CustomQuestionType.SINGLE_SELECT || q.type === CustomQuestionType.MULTI_SELECT) {
      const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      rows.push({ questionId, value: null, valueOptions: values });
    } else {
      rows.push({ questionId, value: String(raw), valueOptions: null });
    }
  }
  return rows;
}

interface CreateIntakeResult {
  intakeId: string;
  patientId: string;
}

export const createAdultIntake = withAudit<
  [{ patientId: string; data: AdultIntakeInput }],
  CreateIntakeResult
>(
  {
    entityType: 'IntakeAssessment',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.intakeId,
    extractAfter: () => ({ type: 'ADULT', event: 'INTAKE_COMPLETED' }),
  },
  async function createAdultIntakeInner({ patientId, data }): Promise<CreateIntakeResult> {
    const session = await auth();
    if (!session?.user?.id) throw new IntakeError(unauthenticated);

    const patient = await db.user.findUnique({
      where: { id: patientId },
      select: { id: true, role: true },
    });
    if (!patient || patient.role !== 'PATIENT') throw new IntakeError(patientNotFound);

    const answerRows = await buildAnswerRows(data.customAnswers, 'ADULT');

    const result = await db.$transaction(async (tx) => {
      const intake = await tx.intakeAssessment.create({
        data: {
          patientId,
          type: IntakeType.ADULT,
          assessedById: session.user.id,
          status: IntakeStatus.COMPLETED,
        },
      });
      await tx.adultIntakeData.create({
        data: {
          intakeId: intake.id,
          physicalActivityLevel: data.physicalActivityLevel,
          medicalDiagnosis: data.medicalDiagnosis,
          primaryComplaint: data.primaryComplaint,
          painTiming: data.painTiming,
          symptomDuration: data.symptomDuration,
          painSeverity: data.painSeverity,
          painAggravatingFactors: data.painAggravatingFactors || null,
          painRelievingFactors: data.painRelievingFactors || null,
          painStability: data.painStability,
          currentMedicationsForProblem: data.currentMedicationsForProblem || null,
          otherMedications: data.otherMedications || null,
          conditions: data.conditions,
          otherConditions: data.otherConditions || null,
          previousFractures: data.previousFractures || null,
          previousSurgeries: data.previousSurgeries || null,
          previousPtExperience: data.previousPtExperience || null,
          referralSource: data.referralSource,
        },
      });
      if (answerRows.length > 0) {
        await tx.intakeCustomAnswer.createMany({
          data: answerRows.map((r) => ({
            intakeId: intake.id,
            questionId: r.questionId,
            value: r.value,
            valueOptions: r.valueOptions === null ? undefined : (r.valueOptions as object),
          })),
        });
      }
      return intake;
    });
    return { intakeId: result.id, patientId };
  },
);

export const createPediatricIntake = withAudit<
  [{ patientId: string; data: PediatricIntakeInput }],
  CreateIntakeResult
>(
  {
    entityType: 'IntakeAssessment',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.intakeId,
    extractAfter: () => ({ type: 'PEDIATRIC', event: 'INTAKE_COMPLETED' }),
  },
  async function createPediatricIntakeInner({ patientId, data }): Promise<CreateIntakeResult> {
    const session = await auth();
    if (!session?.user?.id) throw new IntakeError(unauthenticated);

    const patient = await db.user.findUnique({
      where: { id: patientId },
      select: { id: true, role: true },
    });
    if (!patient || patient.role !== 'PATIENT') throw new IntakeError(patientNotFound);

    const answerRows = await buildAnswerRows(data.customAnswers, 'PEDIATRIC');

    const result = await db.$transaction(async (tx) => {
      const intake = await tx.intakeAssessment.create({
        data: {
          patientId,
          type: IntakeType.PEDIATRIC,
          assessedById: session.user.id,
          status: IntakeStatus.COMPLETED,
        },
      });
      await tx.pediatricIntakeData.create({
        data: {
          intakeId: intake.id,
          numberOfSiblings: data.numberOfSiblings,
          birthOrder: data.birthOrder,
        },
      });
      if (answerRows.length > 0) {
        await tx.intakeCustomAnswer.createMany({
          data: answerRows.map((r) => ({
            intakeId: intake.id,
            questionId: r.questionId,
            value: r.value,
            valueOptions: r.valueOptions === null ? undefined : (r.valueOptions as object),
          })),
        });
      }
      return intake;
    });
    return { intakeId: result.id, patientId };
  },
);

export function intakeToLocalized(err: unknown): LocalizedError {
  if (err instanceof IntakeError) return err.error;
  return toLocalizedError(err);
}
