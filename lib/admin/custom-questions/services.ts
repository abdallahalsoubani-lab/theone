import { AuditAction, Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';

import { listSelectedOptionValues } from './queries';
import { isSelectType } from './schemas';
import type {
  CustomQuestionCreateInput,
  CustomQuestionReorderInput,
  CustomQuestionUpdateInput,
} from './schemas';

export class CustomQuestionAdminError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'CustomQuestionAdminError';
  }
}

const cannotChangeType = (count: number): LocalizedError => ({
  code: 'CUSTOM_Q_TYPE_LOCKED',
  message_en: `Cannot change type: ${count} answer(s) reference this question.`,
  message_ar: `لا يمكن تغيير النوع: ${count} إجابة مرتبطة.`,
  details: { count },
});

const cannotRemoveOption = (count: number): LocalizedError => ({
  code: 'CUSTOM_Q_OPTION_LOCKED',
  message_en: `Cannot remove this option: ${count} answer(s) selected it.`,
  message_ar: `لا يمكن إزالة الخيار: ${count} إجابة اختارته.`,
  details: { count },
});

const cannotDeleteInUse = (count: number): LocalizedError => ({
  code: 'CUSTOM_Q_IN_USE',
  message_en: `Cannot delete: ${count} answer(s) reference this question. Deactivate instead.`,
  message_ar: `لا يمكن الحذف: ${count} إجابة مرتبطة. يمكن التعطيل بدلاً من ذلك.`,
  details: { count },
});

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};

export const createCustomQuestion = withAudit<[CustomQuestionCreateInput], { id: string }>(
  {
    entityType: 'IntakeCustomQuestion',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.id,
    extractAfter: (result) => result,
  },
  async function createCustomQuestionInner(input): Promise<{ id: string }> {
    const session = await auth();
    if (!session?.user?.id) throw new CustomQuestionAdminError(unauthenticated);

    // Append to the end of the existing list under the same scope.
    const max = await db.intakeCustomQuestion.aggregate({
      where: { appliesTo: input.appliesTo },
      _max: { displayOrder: true },
    });
    const nextOrder = (max._max.displayOrder ?? 0) + 1;

    const row = await db.intakeCustomQuestion.create({
      data: {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        type: input.type,
        appliesTo: input.appliesTo,
        required: input.required,
        active: input.active,
        displayOrder: nextOrder,
        // SINGLE_SELECT / MULTI_SELECT persist their options; everything else
        // stores SQL NULL. Cast + Prisma.JsonNull mirror the proven pediatric
        // custom-field path so select options serialize to JSONB reliably
        // (QA retest #3). Passing a bare typed array here is what previously
        // failed for select types.
        options: isSelectType(input.type)
          ? (input.options as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        createdById: session.user.id,
      },
    });
    return { id: row.id };
  },
);

export const updateCustomQuestion = withAudit<[CustomQuestionUpdateInput], { id: string }>(
  {
    entityType: 'IntakeCustomQuestion',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) =>
      db.intakeCustomQuestion.findUnique({ where: { id: args[0].id } }),
    extractAfter: (result) => result,
  },
  async function updateCustomQuestionInner(input): Promise<{ id: string }> {
    const existing = await db.intakeCustomQuestion.findUnique({
      where: { id: input.id },
      include: { _count: { select: { answers: true } } },
    });
    if (!existing) throw new CustomQuestionAdminError(unauthenticated);

    const hasAnswers = existing._count.answers > 0;

    // Edit safety rule 1: cannot change type when answers exist.
    if (hasAnswers && existing.type !== input.type) {
      throw new CustomQuestionAdminError(cannotChangeType(existing._count.answers));
    }

    // Edit safety rule 2: removing an option that has been selected is blocked.
    if (hasAnswers && isSelectType(existing.type)) {
      const usedValues = await listSelectedOptionValues(input.id);
      if (usedValues.size > 0) {
        const newValues = new Set(input.options.map((o) => o.value));
        for (const used of usedValues) {
          if (!newValues.has(used)) {
            // Count answers using THIS specific option.
            const count = await db.intakeCustomAnswer.count({
              where: {
                questionId: input.id,
                valueOptions: { array_contains: used },
              },
            });
            throw new CustomQuestionAdminError(cannotRemoveOption(count));
          }
        }
      }
    }

    await db.intakeCustomQuestion.update({
      where: { id: input.id },
      data: {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        type: input.type,
        appliesTo: input.appliesTo,
        required: input.required,
        active: input.active,
        // SINGLE_SELECT / MULTI_SELECT persist their options; everything else
        // stores SQL NULL. Cast + Prisma.JsonNull mirror the proven pediatric
        // custom-field path so select options serialize to JSONB reliably
        // (QA retest #3). Passing a bare typed array here is what previously
        // failed for select types.
        options: isSelectType(input.type)
          ? (input.options as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
    return { id: input.id };
  },
);

export const reorderCustomQuestions = withAudit<[CustomQuestionReorderInput], { count: number }>(
  {
    // Virtual entity grouping — single audit entry rather than one per row.
    entityType: 'CustomQuestionList',
    action: AuditAction.UPDATE,
    extractEntityId: () => 'order',
    extractAfter: (result) => result,
  },
  async function reorderCustomQuestionsInner({
    orderedIds,
  }: CustomQuestionReorderInput): Promise<{ count: number }> {
    await db.$transaction(
      orderedIds.map((id, i) =>
        db.intakeCustomQuestion.update({
          where: { id },
          data: { displayOrder: i + 1 },
        }),
      ),
    );
    return { count: orderedIds.length };
  },
);

export const deactivateCustomQuestion = withAudit<[string], { id: string }>(
  {
    entityType: 'IntakeCustomQuestion',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'CUSTOM_Q_DEACTIVATED' }),
  },
  async function deactivateInner(id): Promise<{ id: string }> {
    await db.intakeCustomQuestion.update({ where: { id }, data: { active: false } });
    return { id };
  },
);

export const deleteCustomQuestion = withAudit<[string], { id: string }>(
  {
    entityType: 'IntakeCustomQuestion',
    action: AuditAction.DELETE,
    extractEntityId: (args) => args[0],
    extractBefore: async (args) => db.intakeCustomQuestion.findUnique({ where: { id: args[0] } }),
    extractAfter: () => ({ event: 'CUSTOM_Q_DELETED' }),
  },
  async function deleteInner(id): Promise<{ id: string }> {
    const count = await db.intakeCustomAnswer.count({ where: { questionId: id } });
    if (count > 0) throw new CustomQuestionAdminError(cannotDeleteInUse(count));
    await db.intakeCustomQuestion.delete({ where: { id } });
    return { id };
  },
);

export function customQuestionToLocalized(err: unknown): LocalizedError {
  if (err instanceof CustomQuestionAdminError) return err.error;
  return toLocalizedError(err);
}
