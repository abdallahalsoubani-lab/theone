import {
  AppointmentStatus,
  AppointmentType,
  CancellationCategory,
  IntakeType,
} from '@prisma/client';
import { z } from 'zod';

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
 * Series scope — CANCEL ONLY (Prompt 45 rows 1+2). Edits (reschedule,
 * therapist change, drag, resize) always target the single occurrence and
 * carry no scope field at all; only the cancel flow still prompts for a
 * scope and fans out atomically across the series.
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
  // NOTE (Prompt 45 rows 1+2): a reschedule NEVER carries a series scope.
  // The field was removed entirely — an old client (or crafted request)
  // sending `seriesMode` has it silently stripped by Zod, so a mass-edit
  // can no longer be smuggled through this action.
  /**
   * Duration-only resize from the calendar edge (July change request #6).
   * When true this is NOT a reschedule: `startsAt` is unchanged and only the
   * end (durationMinutes) moves. It runs the SAME conflict engine as a drag
   * (PT-B2 §5.2 — the original "free resize" exemption is withdrawn), skips
   * only the "start in the past" guard since the start does not move, and is
   * audited as APPOINTMENT_RESIZED. Always a single-appointment op; no
   * therapist/room change.
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
  // Prompt 45 rows 1+2 — no series scope on edits; see the reschedule schema.
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

// ─── Multi-appointment batch booking (July 31 item 4 — replaces the
//     Prompt 7b weekly-pattern series) ────────────────────────────────────

/**
 * Row cap for one batch. Keeps validation + the per-row conflict sweep
 * snappy and the modal scrollable; a treatment course beyond 30 visits is
 * booked as two batches. Well under the old 52-occurrence series bound.
 */
export const MAX_BATCH_ROWS = 30;

/**
 * Booking types a batch ROW may carry (Prompt 51, series 45+). Only the two
 * patient-bound single-patient types: the batch is anchored to ONE shared
 * patient, so the patient-less EVENT is nonsensical here and the
 * multi-patient GROUP is a separate concern — both stay single-modal only.
 */
export const BATCH_ROW_TYPES = [AppointmentType.SESSION, AppointmentType.STRETCHING] as const;
export type BatchRowType = (typeof BATCH_ROW_TYPES)[number];

/** One explicit appointment row: date+time (one instant), its booking type,
 *  its own therapist set, room, and duration. What you see is what gets
 *  booked. Per-row type rules are the SAME as the single modal's
 *  (appointmentCreateSchema): SESSION ≥1 therapist; STRETCHING zero
 *  therapists (room + beds); room required for both. */
export const batchRowSchema = z
  .object({
    startsAt: z.coerce.date(),
    /** Floor = the calendar's 15-minute resize/step unit (Prompt 26). */
    durationMinutes: z
      .number()
      .int()
      .min(RESIZE_MIN_MINUTES)
      .max(8 * 60),
    appointmentType: z.enum(BATCH_ROW_TYPES).default(AppointmentType.SESSION),
    therapistIds: z.array(z.string().min(1)).max(10).default([]),
    // Room required — consistent with single SESSION/STRETCHING booking
    // (QA retest #7/#13; STRETCHING is room-based).
    roomId: z.string().min(1),
  })
  .superRefine((row, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (row.appointmentType === AppointmentType.SESSION && row.therapistIds.length < 1) {
      issue('therapistIds', 'therapistRequired');
    }
    if (row.appointmentType === AppointmentType.STRETCHING && row.therapistIds.length > 0) {
      issue('therapistIds', 'stretchingNoTherapist');
    }
  });

export type BatchRowInput = z.infer<typeof batchRowSchema>;

const rowKey = (r: BatchRowInput) =>
  `${r.startsAt.getTime()}|${r.roomId}|${[...new Set(r.therapistIds)].sort().join(',')}`;

export const seriesBatchCreateSchema = z
  .object({
    patientId: z.string().min(1),
    notes: z.string().max(2000).optional().nullable(),
    rows: z.array(batchRowSchema).min(1).max(MAX_BATCH_ROWS),
  })
  .superRefine((data, ctx) => {
    // Identical rows (same instant + room + therapist set) are a mistake,
    // not a booking. Flag the LATER duplicate so the first stays valid.
    const seen = new Map<string, number>();
    data.rows.forEach((row, i) => {
      const key = rowKey(row);
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rows', i], message: 'duplicateRow' });
      } else {
        seen.set(key, i);
      }
    });
    // Same-patient overlap INSIDE the batch (duration-aware) — the Prompt 42
    // total-block applied to the rows themselves. The conflict engine can't
    // see not-yet-inserted siblings, so this refine is the authority for
    // batch-internal overlaps; the engine covers overlaps vs. existing rows.
    for (let i = 0; i < data.rows.length; i++) {
      for (let j = i + 1; j < data.rows.length; j++) {
        const a = data.rows[i]!;
        const b = data.rows[j]!;
        const aEnd = a.startsAt.getTime() + a.durationMinutes * 60_000;
        const bEnd = b.startsAt.getTime() + b.durationMinutes * 60_000;
        if (a.startsAt.getTime() < bEnd && b.startsAt.getTime() < aEnd) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', j],
            message: 'overlappingRows',
          });
        }
      }
    }
  });

export type SeriesBatchCreateInput = z.infer<typeof seriesBatchCreateSchema>;

// ─── P52 — new-patient quick-add booking (create patient + intake link +
//     appointment, atomically) ─────────────────────────────────────────────

/**
 * The new-patient branch of the booking modal. Identity is name + phone ONLY
 * (owner decision 1); the secretary picks adult/child (decision 2) so the
 * personal link opens the right form. DOB + gender are deliberately absent —
 * the patient fills them through the intake link (a 1900-01-01 sentinel +
 * null gender are stored until then, matching the P50 import convention).
 * Only patient-bound single types are bookable this way.
 */
export const newPatientBookingSchema = z.object({
  fullNameEn: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(25),
  formType: z.nativeEnum(IntakeType),
  appointmentType: z
    .enum([AppointmentType.SESSION, AppointmentType.STRETCHING])
    .default(AppointmentType.SESSION),
  therapistIds: z.array(z.string().min(1)).max(10).default([]),
  roomId: z.string().min(1),
  startsAt: z.coerce.date(),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(8 * 60),
  notes: z.string().max(2000).optional().nullable(),
  overrideConflicts: z.boolean().default(false),
  // P57 — mirrors patientCreateSchema: the first submit against a number
  // other active patients hold fails with PATIENT_PHONE_SHARED_CONFIRM; the
  // modal confirms and resubmits with this flag. Never a block.
  confirmSharedPhone: z.boolean().default(false),
});

export const newPatientBookingSchemaRefined = newPatientBookingSchema.superRefine((data, ctx) => {
  // Same per-type therapist rule as the single modal: SESSION needs ≥1
  // therapist; STRETCHING has none (room + beds).
  if (data.appointmentType === AppointmentType.SESSION && data.therapistIds.length < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['therapistIds'],
      message: 'therapistRequired',
    });
  }
  if (data.appointmentType === AppointmentType.STRETCHING && data.therapistIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['therapistIds'],
      message: 'stretchingNoTherapist',
    });
  }
});

export type NewPatientBookingInput = z.infer<typeof newPatientBookingSchema>;

export const appointmentListFiltersSchema = z.object({
  /** Inclusive UTC range. Defaults to today through 14 days out at the call site. */
  from: z.coerce.date(),
  to: z.coerce.date(),
  therapistIds: z.array(z.string().min(1)).optional(),
  patientId: z.string().min(1).optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
});

export type AppointmentListFilters = z.infer<typeof appointmentListFiltersSchema>;
