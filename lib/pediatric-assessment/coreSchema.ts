import { z } from 'zod';

import { CORE_SCHEMA_VERSION, STORED_CORE_FIELDS, type CoreField } from './coreFields';

/**
 * Zod schema for the fixed core (Prompt 21 §2/§4) — built from the single
 * source of truth in `coreFields.ts`. `.strict()` rejects unknown keys;
 * required observations + the NICU-days conditional are enforced.
 */

function enumOf(options: readonly string[]): z.ZodEnum<[string, ...string[]]> {
  return z.enum([...options] as [string, ...string[]]);
}

function baseFieldSchema(f: CoreField): z.ZodTypeAny {
  switch (f.type) {
    case 'DATE':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
    case 'TEXT':
      return z.string().max(2000);
    case 'LONG_TEXT':
      return z.string().max(5000);
    case 'SINGLE_SELECT':
      return enumOf(f.options ?? []);
    case 'MULTI_SELECT':
      return z.array(enumOf(f.options ?? []));
    case 'SCORE_0_3':
      return z.number().int().min(0).max(3);
    default:
      return z.string();
  }
}

function buildShape(): z.ZodRawShape {
  const shape: z.ZodRawShape = { schemaVersion: z.literal(CORE_SCHEMA_VERSION) };
  for (const f of STORED_CORE_FIELDS) {
    let s = baseFieldSchema(f);
    if (f.type === 'DATE') {
      // Date is always present (form defaults to today).
      shape[f.key] = s;
      continue;
    }
    if (f.required) {
      if (f.type === 'TEXT' || f.type === 'LONG_TEXT') {
        s = (s as z.ZodString).min(1, 'Required');
      }
      shape[f.key] = s;
    } else {
      shape[f.key] = s.optional();
    }
  }
  return shape;
}

export const coreAssessmentSchema = z
  .object(buildShape())
  .strict()
  .superRefine((val, ctx) => {
    // NICU days are required when NICU = Yes (§4 #15).
    const record = val as Record<string, unknown>;
    if (record.nicu === 'Yes') {
      const days = record.nicuDays;
      if (typeof days !== 'string' || days.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nicuDays'],
          message: 'NICU days are required when NICU = Yes.',
        });
      }
    }
  });

export type CoreAssessmentData = z.infer<typeof coreAssessmentSchema>;

/** A blank core-data object (date defaults to today's clinic-local date string). */
export function emptyCoreData(today: string): Record<string, unknown> {
  return { schemaVersion: CORE_SCHEMA_VERSION, date: today };
}
