import { AppointmentStatus, CancellationCategory } from '@prisma/client';
import { z } from 'zod';

export const appointmentCreateSchema = z.object({
  patientId: z.string().cuid(),
  therapistId: z.string().cuid(),
  roomId: z.string().cuid().optional().nullable(),
  startsAt: z.coerce.date(),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(8 * 60),
  notes: z.string().max(2000).optional().nullable(),
  /**
   * When true and conflicts are present, the action proceeds anyway and
   * writes an OVERRIDE_CONFLICT audit marker. Requires the
   * appointments.override_conflict permission.
   */
  overrideConflicts: z.boolean().default(false),
});

export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;

export const appointmentRescheduleSchema = z.object({
  id: z.string().cuid(),
  startsAt: z.coerce.date(),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(8 * 60),
  therapistId: z.string().cuid().optional(),
  roomId: z.string().cuid().optional().nullable(),
  /**
   * The drag-and-drop path never overrides — the user must reopen the
   * appointment in the modal to confirm an override. The general
   * reschedule modal accepts an override flag.
   */
  overrideConflicts: z.boolean().default(false),
});

export type AppointmentRescheduleInput = z.infer<typeof appointmentRescheduleSchema>;

export const appointmentChangeTherapistSchema = z.object({
  id: z.string().cuid(),
  therapistId: z.string().cuid(),
  /** Optional free-form reason logged on the audit row and surfaced
   *  in the assigned/removed notification body when present. */
  reason: z.string().max(500).optional().nullable(),
  overrideConflicts: z.boolean().default(false),
});

export type AppointmentChangeTherapistInput = z.infer<typeof appointmentChangeTherapistSchema>;

export const appointmentCancelSchema = z.object({
  id: z.string().cuid(),
  cancellationCategory: z.nativeEnum(CancellationCategory),
  // The category drives Prompt 11 analytics; `cancellationReason`
  // remains as the legacy short-label from Prompt 7 (kept so older
  // rows don't break) and `cancellationNotes` is the new free-form
  // field surfaced by the cancel modal.
  cancellationReason: z.string().min(2).max(500),
  cancellationNotes: z.string().max(500).optional().nullable(),
  /** When true and the patient is whatsappReachable, send the
   *  `appointment_cancellation` template. Defaults to true. */
  notifyPatient: z.boolean().default(true),
});

export type AppointmentCancelInput = z.infer<typeof appointmentCancelSchema>;

export const appointmentStatusSchema = z.object({
  id: z.string().cuid(),
  to: z.nativeEnum(AppointmentStatus),
});

export type AppointmentStatusInput = z.infer<typeof appointmentStatusSchema>;

// ─── Recurring series (Prompt 7b §4.4) ────────────────────────────────────

const weekdayEnum = z.enum(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);

export const recurrenceRuleSchema = z.object({
  frequency: z.literal('WEEKLY'),
  interval: z.number().int().min(1).max(8),
  byWeekday: z.array(weekdayEnum).min(1).max(7),
  count: z.number().int().min(1).max(52),
});

export type RecurrenceRuleInput = z.infer<typeof recurrenceRuleSchema>;

/** Per-occurrence resolution chosen in the preview UI. */
export const seriesResolutionSchema = z.enum(['KEEP', 'SKIP', 'SHIFT_1D', 'SHIFT_1W', 'OVERRIDE']);
export type SeriesResolution = z.infer<typeof seriesResolutionSchema>;

export const seriesOccurrenceInputSchema = z.object({
  /** 0-based index from the original expansion. Preserved so the
   *  server can recompute the expanded list and match user choices
   *  back to the planned slots after shifts. */
  index: z.number().int().min(0),
  /** UTC start. May differ from the expanded value when the user
   *  chose SHIFT_1D / SHIFT_1W. */
  startsAt: z.coerce.date(),
  resolution: seriesResolutionSchema,
});

export const seriesPreviewSchema = z.object({
  patientId: z.string().cuid(),
  therapistId: z.string().cuid(),
  roomId: z.string().cuid().optional().nullable(),
  startsAt: z.coerce.date(),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(8 * 60),
  rule: recurrenceRuleSchema,
});

export type SeriesPreviewInput = z.infer<typeof seriesPreviewSchema>;

export const seriesCreateSchema = seriesPreviewSchema.extend({
  notes: z.string().max(2000).optional().nullable(),
  /** Resolved per-occurrence decisions. Must cover every occurrence in
   *  the expansion (the server re-expands to validate the count). */
  resolutions: z.array(seriesOccurrenceInputSchema).min(1).max(52),
});

export type SeriesCreateInput = z.infer<typeof seriesCreateSchema>;

export const appointmentListFiltersSchema = z.object({
  /** Inclusive UTC range. Defaults to today through 14 days out at the call site. */
  from: z.coerce.date(),
  to: z.coerce.date(),
  therapistIds: z.array(z.string().cuid()).optional(),
  patientId: z.string().cuid().optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
});

export type AppointmentListFilters = z.infer<typeof appointmentListFiltersSchema>;
