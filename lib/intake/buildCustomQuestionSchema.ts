import { CustomQuestionType } from '@prisma/client';
import { z } from 'zod';

import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';

/**
 * Build a Zod schema for the customAnswers map keyed by question id, from
 * the active question records. Validation rules:
 *   TEXT / TEXTAREA      → string (required if question.required)
 *   NUMBER               → string-coerced number (matches the form input
 *                          shape; stored as string per Prompt 6 §4.6)
 *   DATE                 → ISO-format string YYYY-MM-DD
 *   SINGLE_SELECT        → exactly one option value
 *   MULTI_SELECT         → array of option values; non-empty when required
 *
 * Returns a schema over `Record<string, unknown>`. The intake action layer
 * runs `customQuestionsSchema.parse(input.customAnswers)` and then converts
 * each entry to its IntakeCustomAnswer row shape (value vs valueOptions).
 */
export function buildCustomQuestionSchema(
  questions: ReadonlyArray<CustomQuestionRow>,
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const q of questions) {
    let field: z.ZodTypeAny;
    switch (q.type) {
      case CustomQuestionType.TEXT:
      case CustomQuestionType.TEXTAREA:
        field = q.required
          ? z.string().min(1, 'required').max(2000)
          : z.string().max(2000).optional().or(z.literal('')).nullable();
        break;
      case CustomQuestionType.NUMBER:
        field = q.required
          ? z
              .union([z.string(), z.number()])
              .transform((v) => String(v))
              .refine((v) => v.length > 0 && !Number.isNaN(Number(v)), 'required')
          : z
              .union([z.string(), z.number(), z.null(), z.undefined()])
              .transform((v) => (v === null || v === undefined || v === '' ? null : String(v)));
        break;
      case CustomQuestionType.DATE:
        field = q.required
          ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'required')
          : z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional()
              .or(z.literal(''))
              .nullable();
        break;
      case CustomQuestionType.SINGLE_SELECT: {
        const optionValues = q.options.map((o) => o.value) as [string, ...string[]];
        if (optionValues.length === 0) {
          field = z.never();
        } else {
          const base = z.enum(optionValues);
          field = q.required ? base : base.optional().nullable();
        }
        break;
      }
      case CustomQuestionType.MULTI_SELECT: {
        const optionValues = q.options.map((o) => o.value);
        const base = z.array(z.enum(optionValues as [string, ...string[]]));
        field = q.required ? base.min(1, 'required') : base.default([]);
        break;
      }
      default:
        field = z.unknown();
    }
    shape[q.id] = field;
  }

  return z.object(shape);
}

function isEmptyAnswer(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Issues for a `customAnswers` map against the ACTIVE questions (P64 #8).
 *
 * Since the fixed intake fields were retired, the admin custom questions ARE
 * the intake — so their `required` flag must actually be enforced (it was only
 * a label asterisk before). Empty answers to required questions report the
 * `required` validation token so FormMessage localizes them.
 */
export function customAnswerIssues(
  questions: ReadonlyArray<CustomQuestionRow>,
  answers: Record<string, unknown> | null | undefined,
): Array<{ questionId: string; message: string }> {
  const active = questions.filter((q) => q.active);
  const map = answers ?? {};
  const parsed = buildCustomQuestionSchema(active).safeParse(map);
  if (parsed.success) return [];
  const seen = new Set<string>();
  const out: Array<{ questionId: string; message: string }> = [];
  for (const issue of parsed.error.issues) {
    const questionId = String(issue.path[0] ?? '');
    if (!questionId || seen.has(questionId)) continue;
    seen.add(questionId);
    out.push({
      questionId,
      message: isEmptyAnswer(map[questionId]) ? 'required' : issue.message,
    });
  }
  return out;
}

/**
 * Wrap an intake schema (whose output has `customAnswers`) so the client form
 * blocks submit on a missing required custom answer, with the error on
 * `customAnswers.<questionId>` — exactly the RHF field name the question uses.
 */
export function withCustomAnswerRules<S extends z.ZodTypeAny>(
  schema: S,
  questions: ReadonlyArray<CustomQuestionRow>,
) {
  return schema.superRefine((value: unknown, ctx) => {
    const answers = (value as { customAnswers?: Record<string, unknown> } | null)?.customAnswers;
    for (const i of customAnswerIssues(questions, answers)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: i.message,
        path: ['customAnswers', i.questionId],
      });
    }
  });
}
