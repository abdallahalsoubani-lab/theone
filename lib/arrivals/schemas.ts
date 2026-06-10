import { z } from 'zod';

/** Kiosk submit: the device token + the typed phone (any accepted shape). */
export const kioskCheckInSchema = z.object({
  token: z.string().min(16),
  phone: z.string().min(1).max(32),
});
export type KioskCheckInInput = z.infer<typeof kioskCheckInSchema>;

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
