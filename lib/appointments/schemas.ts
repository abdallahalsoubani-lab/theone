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

export const appointmentListFiltersSchema = z.object({
  /** Inclusive UTC range. Defaults to today through 14 days out at the call site. */
  from: z.coerce.date(),
  to: z.coerce.date(),
  therapistIds: z.array(z.string().cuid()).optional(),
  patientId: z.string().cuid().optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
});

export type AppointmentListFilters = z.infer<typeof appointmentListFiltersSchema>;
