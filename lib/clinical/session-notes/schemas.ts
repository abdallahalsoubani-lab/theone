import { z } from 'zod';

/**
 * Session-note Zod schemas (Prompt 9 §4.7).
 *
 * Pain score is the only required clinical field; SOAP fields are
 * optional. This mirrors how real therapists actually use SOAP — they
 * fill what's relevant, not all four sections on every note. The free-
 * form `measurements` JSON column stays out of the schema for v1; until
 * we have data on what therapists actually write, pre-structuring those
 * fields is premature.
 */

const optionalText = z.string().max(5000).optional().nullable();

export const sessionNoteCreateSchema = z.object({
  appointmentId: z.string().min(1),
  subjective: optionalText,
  objective: optionalText,
  assessment: optionalText,
  plan: optionalText,
  painScore: z.number().int().min(0).max(10),
  measurements: z.string().max(5000).optional().nullable(),
});

export const sessionNoteUpdateSchema = z.object({
  noteId: z.string().min(1),
  subjective: optionalText,
  objective: optionalText,
  assessment: optionalText,
  plan: optionalText,
  painScore: z.number().int().min(0).max(10),
  measurements: z.string().max(5000).optional().nullable(),
});

export const sessionNoteAddendumSchema = z.object({
  parentNoteId: z.string().min(1),
  subjective: optionalText,
  objective: optionalText,
  assessment: optionalText,
  plan: optionalText,
  painScore: z.number().int().min(0).max(10),
  measurements: z.string().max(5000).optional().nullable(),
});

export type SessionNoteCreateInput = z.infer<typeof sessionNoteCreateSchema>;
export type SessionNoteUpdateInput = z.infer<typeof sessionNoteUpdateSchema>;
export type SessionNoteAddendumInput = z.infer<typeof sessionNoteAddendumSchema>;
