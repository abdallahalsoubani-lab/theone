import { z } from 'zod';

/**
 * Treatment plan zod schemas.
 *
 * Shared between the create (Doctor) and propose-change (Therapist)
 * paths. The propose flow extends the create shape with a required
 * `proposalReason` field; everything else has the same shape so the
 * Doctor's form and the Therapist's edit form can reuse one component.
 */

export const planExerciseSchema = z.object({
  exerciseId: z.string().min(1),
  sets: z.number().int().min(1).max(50),
  reps: z.number().int().min(1).max(200),
  durationSeconds: z
    .number()
    .int()
    .min(0)
    .max(60 * 60),
  customNotes: z.string().max(500).optional().nullable(),
  order: z.number().int().min(0),
});

export const planCreateSchema = z.object({
  patientId: z.string().min(1),
  assignedTherapistId: z.string().min(1),
  diagnosisPrimary: z.string().min(5).max(2000),
  diagnosisSecondary: z.string().max(2000).optional().nullable(),
  goalsShortTerm: z.string().min(5).max(2000),
  goalsLongTerm: z.string().max(2000).optional().nullable(),
  frequencyPerWeek: z.number().int().min(1).max(7),
  durationWeeks: z.number().int().min(1).max(52),
  therapistNotes: z.string().max(2000).optional().nullable(),
  exercises: z.array(planExerciseSchema).min(1, 'A plan must include at least one exercise.'),
});

export const planProposeSchema = planCreateSchema.extend({
  activePlanId: z.string().min(1),
  proposalReason: z
    .string()
    .min(10, 'Proposal reason must explain the change (min 10 characters).')
    .max(2000),
});

export const planRejectSchema = z.object({
  proposedPlanId: z.string().min(1),
  rejectedReason: z.string().min(5).max(2000),
});

export const planLifecycleSchema = z.object({
  planId: z.string().min(1),
});

export type PlanCreateInput = z.infer<typeof planCreateSchema>;
export type PlanProposeInput = z.infer<typeof planProposeSchema>;
export type PlanExerciseInput = z.infer<typeof planExerciseSchema>;
export type PlanRejectInput = z.infer<typeof planRejectSchema>;
