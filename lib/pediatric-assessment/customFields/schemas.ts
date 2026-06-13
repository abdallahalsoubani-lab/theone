import { PediatricCustomFieldType } from '@prisma/client';
import { z } from 'zod';

/** One option for a SINGLE_SELECT / MULTI_SELECT custom field. */
export const customFieldOptionSchema = z.object({
  value: z.string().min(1).max(64), // stable id (kept even if labels change)
  labelEn: z.string().min(1).max(200),
  labelAr: z.string().min(1).max(200),
});
export type CustomFieldOption = z.infer<typeof customFieldOptionSchema>;

const SELECT_TYPES: PediatricCustomFieldType[] = [
  PediatricCustomFieldType.SINGLE_SELECT,
  PediatricCustomFieldType.MULTI_SELECT,
];

const base = {
  labelEn: z.string().min(1).max(300),
  labelAr: z.string().min(1).max(300),
  type: z.nativeEnum(PediatricCustomFieldType),
  section: z.string().max(120).optional().nullable(),
  order: z.number().int().min(0).max(9999).optional(),
  options: z.array(customFieldOptionSchema).max(40).optional().default([]),
};

function requireOptionsForSelects<
  T extends { type: PediatricCustomFieldType; options: CustomFieldOption[] },
>(d: T, ctx: z.RefinementCtx): void {
  if (SELECT_TYPES.includes(d.type) && d.options.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['options'],
      message: 'Select fields need at least 2 options.',
    });
  }
}

export const customFieldCreateSchema = z.object(base).superRefine(requireOptionsForSelects);
export type CustomFieldCreateInput = z.input<typeof customFieldCreateSchema>;
export type CustomFieldCreateParsed = z.infer<typeof customFieldCreateSchema>;

export const customFieldUpdateSchema = z
  .object({ id: z.string().min(1), active: z.boolean().optional(), ...base })
  .superRefine(requireOptionsForSelects);
export type CustomFieldUpdateInput = z.input<typeof customFieldUpdateSchema>;
export type CustomFieldUpdateParsed = z.infer<typeof customFieldUpdateSchema>;

export const customFieldIdSchema = z.object({ id: z.string().min(1) });
