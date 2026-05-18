import { z } from 'zod';

export const doctorReviewCreateSchema = z.object({
  patientId: z.string().min(1),
  weekStarting: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.'),
  comment: z.string().min(10, 'Comment required (min 10 characters).').max(5000),
});

export type DoctorReviewCreateInput = z.infer<typeof doctorReviewCreateSchema>;
