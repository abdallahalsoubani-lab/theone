import { z } from 'zod';

/**
 * HomeProgramItem Zod schemas (Prompt 10 §4.5).
 *
 * daysOfWeek: 0=Sunday … 6=Saturday. Refinements mirror the Postgres
 * CHECK constraint added in the migration so a server-side validation
 * error is friendlier than a P0001.
 */

const daysOfWeekSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'Select at least one day.')
  .max(7)
  .refine((arr) => new Set(arr).size === arr.length, 'Each day can only be selected once.');

const scheduledTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24-hour).');

export const homeProgramItemCreateSchema = z.object({
  patientId: z.string().min(1),
  exerciseId: z.string().min(1),
  daysOfWeek: daysOfWeekSchema,
  scheduledTime: scheduledTimeSchema,
  durationMinutes: z.number().int().min(1).max(180),
  setsReps: z.string().max(50).optional().nullable(),
  therapistNote: z.string().max(2000).optional().nullable(),
});

export const homeProgramItemUpdateSchema = homeProgramItemCreateSchema.extend({
  id: z.string().min(1),
  active: z.boolean().default(true),
});

export const homeProgramItemSetActiveSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

export const markCompleteSchema = z.object({
  itemId: z.string().min(1),
  painScore: z.number().int().min(0).max(10).optional().nullable(),
});

export type HomeProgramItemCreateInput = z.infer<typeof homeProgramItemCreateSchema>;
export type HomeProgramItemUpdateInput = z.infer<typeof homeProgramItemUpdateSchema>;
export type MarkCompleteInput = z.infer<typeof markCompleteSchema>;
