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
