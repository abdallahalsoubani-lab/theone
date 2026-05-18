import { z } from 'zod';

export const patientEntrySchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1),
  note: z.string().max(2000),
});

export const dayReportSubmitSchema = z.object({
  /** Date the report covers, ISO YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.'),
  overallSummary: z.string().min(5, 'Overall summary required.').max(5000),
  patientEntries: z.array(patientEntrySchema),
});

export type DayReportSubmitInput = z.infer<typeof dayReportSubmitSchema>;
