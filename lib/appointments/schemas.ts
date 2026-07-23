import { AppointmentStatus, AppointmentType, CancellationCategory } from '@prisma/client';
import { z } from 'zod';

/** At least one therapist per appointment (Prompt 20 — SESSION only). */
const therapistIdsSchema = z.array(z.string().min(1)).min(1).max(10);

export const appointmentCreateSchema = z
  .object({
    // Optional for EVENT (patient-less internal block — July #8 part 2).
    // SESSION + STRETCHING require it (enforced in superRefine).
    patientId: z.string().min(1).optional().nullable(),
    // July #8 — type-aware: SESSION requires ≥1 therapist; STRETCHING forbids
    // therapists (room + beds, no therapist); EVENT allows 0..N. The per-type
    // rule is enforced in superRefine below.
    therapistIds: z.array(z.string().min(1)).max(10).default([]),
    // Optional at the base — required for SESSION + STRETCHING (QA retest
    // #7/#13; STRETCHING is room-based) and OPTIONAL for EVENT (a meeting may
    // hold a room, or not). Enforced in superRefine.
    roomId: z.string().min(1).optional().nullable(),
    // GROUP therapy / workshops (July #8 part 3) — the group's patients. Open
    // capacity (no fixed max beyond a sanity cap). Empty for non-GROUP types.
    patientIds: z.array(z.string().min(1)).max(200).default([]),
    // Free-text label — required for EVENT (patient-less); the optional
    // "Workshop X" name for a GROUP; forbidden for SESSION/STRETCHING.
    title: z.string().min(1).max(200).optional().nullable(),
    appointmentType: z.nativeEnum(AppointmentType).default(AppointmentType.SESSION),
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
  })
  .superRefine((data, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (data.appointmentType === AppointmentType.SESSION) {
      if (data.therapistIds.length < 1) issue('therapistIds', 'therapistRequired');
      if (!data.patientId) issue('patientId', 'patientRequired');
      if (!data.roomId) issue('roomId', 'roomRequired');
    }
    if (data.appointmentType === AppointmentType.STRETCHING) {
      if (data.therapistIds.length > 0) issue('therapistIds', 'stretchingNoTherapist');
      if (!data.patientId) issue('patientId', 'patientRequired');
      if (!data.roomId) issue('roomId', 'roomRequired');
    }
    if (data.appointmentType === AppointmentType.EVENT) {
      // Patient-less internal block: no patient, a title is the label; room +
      // therapists are optional.
      if (data.patientId) issue('patientId', 'eventNoPatient');
      if (data.patientIds.length > 0) issue('patientIds', 'eventNoPatient');
      if (!data.title) issue('title', 'eventTitleRequired');
    }
    if (data.appointmentType === AppointmentType.GROUP) {
      // Many patients (open), ≥1 therapist. The single scalar patientId is
      // unused (patients live in the M2M); the title is the optional label.
      if (data.patientIds.length < 1) issue('patientIds', 'groupPatientsRequired');
      if (data.therapistIds.length < 1) issue('therapistIds', 'therapistRequired');
      if (data.patientId) issue('patientId', 'groupUsesPatientIds');
    }
    // Non-GROUP types never carry a patient SET.
    if (data.appointmentType !== AppointmentType.GROUP && data.patientIds.length > 0) {
      issue('patientIds', 'patientIdsGroupOnly');
    }
  });

export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;

/**
 * Series-edit scope (Prompt 7b §4.7). The user is prompted before
 * cancel / reschedule / change-therapist actions on a series-bound
 * appointment. The action then receives the explicit mode so the
 * service can fan out atomically across the chosen scope.
 */
export const seriesEditModeSchema = z.enum(['ONE', 'FOLLOWING', 'ALL']);
export type SeriesEditMode = z.infer<typeof seriesEditModeSchema>;

/**
 * Minimum appointment length a calendar edge-resize can produce — the grid
 * slot size (step=15). A resize dragged below this clamps up to it so a drag
 * never creates a zero/negative-length appointment (July #6).
 */
export const RESIZE_MIN_MINUTES = 15;

export const appointmentRescheduleSchema = z.object({
  id: z.string().min(1),
  startsAt: z.coerce.date(),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(8 * 60),
  /**
   * Optional therapist set for this slot (Prompt 20). Omitted → keep the
   * existing therapists (pure time/room move, e.g. dragging a multi-therapist
   * session). Provided → replace the set (e.g. dragging a single-therapist
   * appointment into another therapist's lane).
   */
  therapistIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  roomId: z.string().min(1).optional().nullable(),
  /**
   * The drag-and-drop path never overrides — the user must reopen the
   * appointment in the modal to confirm an override. The general
   * reschedule modal accepts an override flag.
   */
  overrideConflicts: z.boolean().default(false),
  /** Defaults to ONE so the existing single-appointment paths continue
   *  to work unchanged. FOLLOWING / ALL fan out across the series. */
  seriesMode: seriesEditModeSchema.default('ONE'),
  /**
   * Duration-only resize from the calendar edge (July change request #6).
   * When true this is NOT a reschedule: `startsAt` is unchanged and only the
   * end (durationMinutes) moves. The clinic wants free resize — it SKIPS the
   * conflict check (overlaps allowed) and the "start in the past" guard, and
   * is audited as APPOINTMENT_RESIZED. Always a single-appointment op
   * (seriesMode ONE); no therapist/room change.
   */
  resize: z.boolean().default(false),
});

export type AppointmentRescheduleInput = z.input<typeof appointmentRescheduleSchema>;
export type AppointmentRescheduleParsed = z.infer<typeof appointmentRescheduleSchema>;

/**
 * "Manage therapists" (Prompt 20 — was "change therapist"). Sets the full
 * therapist set for an appointment; the service diffs against the current set
 * to add/remove and notify. Min 1 therapist.
 */
export const appointmentChangeTherapistSchema = z.object({
  id: z.string().min(1),
  therapistIds: z.array(z.string().min(1)).min(1).max(10),
  /** Optional free-form reason logged on the audit row and surfaced
   *  in the assigned/removed notification body when present. */
  reason: z.string().max(500).optional().nullable(),
  overrideConflicts: z.boolean().default(false),
  seriesMode: seriesEditModeSchema.default('ONE'),
});

export type AppointmentChangeTherapistInput = z.input<typeof appointmentChangeTherapistSchema>;
export type AppointmentChangeTherapistParsed = z.infer<typeof appointmentChangeTherapistSchema>;

export const appointmentCancelSchema = z.object({
  id: z.string().min(1),
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
  seriesMode: seriesEditModeSchema.default('ONE'),
});

export type AppointmentCancelInput = z.input<typeof appointmentCancelSchema>;
export type AppointmentCancelParsed = z.infer<typeof appointmentCancelSchema>;

export const appointmentStatusSchema = z.object({
  id: z.string().min(1),
  to: z.nativeEnum(AppointmentStatus),
});

export type AppointmentStatusInput = z.infer<typeof appointmentStatusSchema>;

/** Cancelled-appointments view filters (Prompt 17). Range applies to when the
 *  appointment was cancelled; default last 30 days, newest first. */
export const cancelledAppointmentFiltersSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  therapistId: z.string().min(1).optional(),
  search: z.string().optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export type CancelledAppointmentFilters = z.infer<typeof cancelledAppointmentFiltersSchema>;

// ─── Recurring series (Prompt 7b §4.4) ────────────────────────────────────

const weekdayEnum = z.enum(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);

export const recurrenceRuleSchema = z
  .object({
    frequency: z.literal('WEEKLY'),
    interval: z.number().int().min(1).max(8),
    // Prompt 46 (owner ruling): the fixed 2-days-per-week cap from Prompt 22
    // §4.2 is REMOVED — any subset of the week is selectable. The remaining
    // limits are the R-6 refine below (days ≤ count) and the closed-day
    // check in the series service (settings-driven).
    byWeekday: z.array(weekdayEnum).min(1).max(7),
    count: z.number().int().min(1).max(52),
  })
  // R-6 (Prompt 42): you can't spread the pattern over more weekdays than the
  // series has appointments (count=1 → 1 selectable day). The picker enforces
  // this in the UI; the refine rejects crafted requests server-side.
  .refine((r) => r.byWeekday.length <= r.count, {
    message: 'byWeekday must not exceed count (R-6)',
    path: ['byWeekday'],
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
  patientId: z.string().min(1),
  therapistIds: therapistIdsSchema,
  // Room required for recurring create too (QA retest #7/#13).
  roomId: z.string().min(1),
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
  therapistIds: z.array(z.string().min(1)).optional(),
  patientId: z.string().min(1).optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
});

export type AppointmentListFilters = z.infer<typeof appointmentListFiltersSchema>;
