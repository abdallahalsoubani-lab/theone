import { LeaveType } from '@prisma/client';
import { z } from 'zod';

/**
 * Leave management (Prompt 11 §4.1). Staff request a leave window;
 * Admin approves or rejects. Approved leaves drive the conflict-scan
 * that fans out inbox items to the Secretary.
 */

export const leaveRequestSchema = z
  .object({
    leaveType: z.nativeEnum(LeaveType),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    reason: z.string().min(5).max(1000),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })
  .refine(
    (d) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return d.startDate >= today;
    },
    {
      message: 'startDate must be today or in the future',
      path: ['startDate'],
    },
  );

export type LeaveRequestInput = z.input<typeof leaveRequestSchema>;
export type LeaveRequestParsed = z.infer<typeof leaveRequestSchema>;

export const leaveApproveSchema = z.object({
  id: z.string().min(1),
});
export type LeaveApproveInput = z.infer<typeof leaveApproveSchema>;

export const leaveRejectSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(5).max(1000),
});
export type LeaveRejectInput = z.infer<typeof leaveRejectSchema>;
