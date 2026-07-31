import { z } from 'zod';

/** Kiosk today's-rows list (July 31 item 2 — replaced the Prompt 46 cards). */
export const kioskTodaySchema = z.object({
  token: z.string().min(16),
});
export type KioskTodayInput = z.infer<typeof kioskTodaySchema>;

/** Kiosk commit (July #1): the device token + the selected patient id, plus
 *  the tapped row's anchor appointment (July 31 item 2) so the commit
 *  targets that run exactly. Optional for the legacy next-upcoming path. */
export const kioskCheckInByNameSchema = z.object({
  token: z.string().min(16),
  patientId: z.string().min(1).max(64),
  appointmentId: z.string().min(1).max(64).optional(),
});
export type KioskCheckInByNameInput = z.infer<typeof kioskCheckInByNameSchema>;

/** Staff manual check-in / undo target. */
export const arrivalActionSchema = z.object({
  appointmentId: z.string().min(1),
});
export type ArrivalActionInput = z.infer<typeof arrivalActionSchema>;

/** Live "current delay" quick-edit. Bounded to a sane 0–240 minutes. */
export const currentDelaySchema = z.object({
  minutes: z.coerce.number().int().min(0).max(240),
});
export type CurrentDelayInput = z.infer<typeof currentDelaySchema>;

/** Which public surface a token op targets. */
export const arrivalsSurfaceSchema = z.object({
  surface: z.enum(['kiosk', 'display']),
});
export type ArrivalsSurfaceInput = z.infer<typeof arrivalsSurfaceSchema>;
