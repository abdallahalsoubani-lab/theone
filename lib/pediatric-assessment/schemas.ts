import { z } from 'zod';

/**
 * Save shapes for a pediatric assessment. `coreData` is validated separately
 * against the strict `coreAssessmentSchema` (lib/pediatric-assessment/coreSchema)
 * at the action layer; here it's an opaque record. `customData` is a flexible
 * map of customFieldId → value (the custom fields change over time).
 */
export const assessmentCreateSchema = z.object({
  patientId: z.string().min(1),
  coreData: z.record(z.unknown()),
  customData: z.record(z.unknown()).default({}),
});
export type AssessmentCreateInput = z.input<typeof assessmentCreateSchema>;
export type AssessmentCreateParsed = z.infer<typeof assessmentCreateSchema>;

export const assessmentUpdateSchema = z.object({
  id: z.string().min(1),
  coreData: z.record(z.unknown()),
  customData: z.record(z.unknown()).default({}),
});
export type AssessmentUpdateInput = z.input<typeof assessmentUpdateSchema>;
export type AssessmentUpdateParsed = z.infer<typeof assessmentUpdateSchema>;
