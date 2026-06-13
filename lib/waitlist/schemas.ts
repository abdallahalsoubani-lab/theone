import { z } from 'zod';

/**
 * Add a patient to the booking waitlist (Prompt 19 §3). The desired window is
 * an explicit [windowStart, windowEnd) range; `desiredDate` is derived
 * server-side from `windowStart` (clinic-local day) so callers don't have to.
 * When prefilled from a taken slot the window defaults to exactly that slot.
 */
export const waitlistAddSchema = z
  .object({
    patientId: z.string().min(1),
    windowStart: z.coerce.date(),
    windowEnd: z.coerce.date(),
    preferredTherapistId: z.string().min(1).optional().nullable(),
    note: z.string().max(500).optional().nullable(),
  })
  .refine((d) => d.windowEnd.getTime() > d.windowStart.getTime(), {
    message: 'windowEnd must be after windowStart',
    path: ['windowEnd'],
  });

export type WaitlistAddInput = z.input<typeof waitlistAddSchema>;
export type WaitlistAddParsed = z.infer<typeof waitlistAddSchema>;

/** Manual remove (status → REMOVED). */
export const waitlistRemoveSchema = z.object({
  id: z.string().min(1),
});
export type WaitlistRemoveInput = z.infer<typeof waitlistRemoveSchema>;

/** Mark an entry FULFILLED after a one-click placement booked an appointment. */
export const waitlistFulfillSchema = z.object({
  entryId: z.string().min(1),
  appointmentId: z.string().min(1),
});
export type WaitlistFulfillInput = z.infer<typeof waitlistFulfillSchema>;

/** Management-page status filter. */
export const waitlistStatusFilterSchema = z
  .enum(['ALL', 'WAITING', 'FULFILLED', 'EXPIRED', 'REMOVED'])
  .default('WAITING');
export type WaitlistStatusFilter = z.infer<typeof waitlistStatusFilterSchema>;
