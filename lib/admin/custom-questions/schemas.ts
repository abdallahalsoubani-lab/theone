import { CustomQuestionAppliesTo, CustomQuestionType } from '@prisma/client';
import { z } from 'zod';

export const customQuestionOptionSchema = z.object({
  /** Stable per-question key; uuid-ish. Generated client-side on add. */
  value: z.string().min(1).max(64),
  valueEn: z.string().min(1).max(200),
  valueAr: z.string().min(1).max(200),
});

export type CustomQuestionOption = z.infer<typeof customQuestionOptionSchema>;

export const customQuestionCreateSchema = z
  .object({
    nameEn: z.string().min(2).max(300),
    nameAr: z.string().min(2).max(300),
    type: z.nativeEnum(CustomQuestionType),
    appliesTo: z.nativeEnum(CustomQuestionAppliesTo),
    required: z.boolean().default(false),
    active: z.boolean().default(true),
    options: z.array(customQuestionOptionSchema).default([]),
  })
  .refine(
    (v) => {
      if (v.type === 'SINGLE_SELECT' || v.type === 'MULTI_SELECT') {
        return v.options.length >= 2;
      }
      return true;
    },
    { message: 'atLeastOne', path: ['options'] },
  );

export const customQuestionUpdateSchema = z
  .object({
    id: z.string().cuid(),
    nameEn: z.string().min(2).max(300),
    nameAr: z.string().min(2).max(300),
    type: z.nativeEnum(CustomQuestionType),
    appliesTo: z.nativeEnum(CustomQuestionAppliesTo),
    required: z.boolean(),
    active: z.boolean(),
    options: z.array(customQuestionOptionSchema).default([]),
  })
  .refine(
    (v) => {
      if (v.type === 'SINGLE_SELECT' || v.type === 'MULTI_SELECT') {
        return v.options.length >= 2;
      }
      return true;
    },
    { message: 'atLeastOne', path: ['options'] },
  );

export type CustomQuestionCreateInput = z.infer<typeof customQuestionCreateSchema>;
export type CustomQuestionUpdateInput = z.infer<typeof customQuestionUpdateSchema>;

export const customQuestionReorderSchema = z.object({
  orderedIds: z.array(z.string().cuid()).min(1),
});
export type CustomQuestionReorderInput = z.infer<typeof customQuestionReorderSchema>;

export function isSelectType(type: CustomQuestionType): boolean {
  return type === CustomQuestionType.SINGLE_SELECT || type === CustomQuestionType.MULTI_SELECT;
}
