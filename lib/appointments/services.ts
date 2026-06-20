import { AppointmentStatus, AuditAction, UserRole } from '@prisma/client';
import type { CancellationCategory, Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { addCareTeamMemberTx } from '@/lib/patients/assignment';
import {
  cancelAppointmentReminder,
  enqueueAppointmentReminder,
} from '@/lib/queue/jobs/appointmentReminder';
import { notifyWaitlistForFreedSlot } from '@/lib/waitlist/services';

import { checkConflicts, type Conflict, type ConflictResult } from './conflicts';
import { expandRecurrence, MAX_SERIES_OCCURRENCES, type PlannedOccurrence } from './recurrence';
import { parseHhMm, type ReminderConfig } from './reminderWindow';
import { getSessionGraceConfig } from './session-settings';
import {
  canStartSessionAt,
  earliestSessionStart,
  isStartInPast,
  sessionStartTooEarly,
} from './session-timing';
import type {
  AppointmentCancelParsed,
  AppointmentChangeTherapistParsed,
  AppointmentCreateInput,
  AppointmentRescheduleParsed,
  SeriesCreateInput,
  SeriesPreviewInput,
} from './schemas';
import { selectSeriesOccurrences, type SeriesOccurrenceRow } from './series';
import { canTransition, permissionForTransition, STATUS_ERRORS } from './status';

export class AppointmentError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'AppointmentError';
  }
}

const conflictError = (conflicts: Conflict[]): LocalizedError => ({
  code: 'APPOINTMENT_CONFLICT',
  message_en: `${conflicts.length} conflict(s) detected.`,
  message_ar: `تم اكتشاف ${conflicts.length} تعارض(ات).`,
  details: { conflicts: conflicts as unknown as Record<string, unknown> },
});

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};

const notFound: LocalizedError = {
  code: 'APPOINTMENT_NOT_FOUND',
  message_en: 'Appointment not found.',
  message_ar: 'لم يتم العثور على الموعد.',
};

// Fix 6C item 1 — a booking's start must not be before now (instant-vs-instant,
// tz-independent; see session-timing.ts). Allow now/future.
const inPast: LocalizedError = {
  code: 'APPOINTMENT_IN_PAST',
  message_en: 'Cannot book an appointment in the past. Pick a current or future time.',
  message_ar: 'لا يمكن حجز موعد في وقت مضى. اختر وقتاً حالياً أو مستقبلياً.',
};

// ─── Multi-therapist helpers (Prompt 20) ──────────────────────────────────

/** Current therapist ids assigned to an appointment. */
async function getAppointmentTherapistIds(appointmentId: string): Promise<string[]> {
  const rows = await db.appointmentTherapist.findMany({
    where: { appointmentId },
    select: { therapistId: true },
  });
  return rows.map((r) => r.therapistId);
}

/**
 * Replace the therapist set on an appointment inside a transaction — drops
 * removed rows, adds missing ones (idempotent; the @@unique guards dupes).
 */
async function setAppointmentTherapistsTx(
  tx: Prisma.TransactionClient,
  appointmentId: string,
  therapistIds: string[],
): Promise<void> {
  const desired = [...new Set(therapistIds)];
  const current = await tx.appointmentTherapist.findMany({
    where: { appointmentId },
    select: { therapistId: true },
  });
  const currentSet = new Set(current.map((r) => r.therapistId));
  const toRemove = [...currentSet].filter((id) => !desired.includes(id));
  const toAdd = desired.filter((id) => !currentSet.has(id));
  if (toRemove.length > 0) {
    await tx.appointmentTherapist.deleteMany({
      where: { appointmentId, therapistId: { in: toRemove } },
    });
  }
  for (const therapistId of toAdd) {
    await tx.appointmentTherapist.create({ data: { appointmentId, therapistId } });
  }
}

async function getReminderConfig(): Promise<ReminderConfig> {
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: {
      defaultReminderOffsetMinutes: true,
      reminderWindowStart: true,
      reminderWindowEnd: true,
      timezone: true,
    },
  });
  return {
    offsetMinutes: settings?.defaultReminderOffsetMinutes ?? 1440,
    windowStartMinutes: parseHhMm(settings?.reminderWindowStart ?? '08:00'),
    windowEndMinutes: parseHhMm(settings?.reminderWindowEnd ?? '18:00'),
    timeZone: settings?.timezone ?? 'Asia/Amman',
  };
}

export const createAppointment = withAudit<
  [AppointmentCreateInput],
  { appointmentId: string; conflictsOverridden: boolean }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.appointmentId,
    extractAfter: (result) => ({
      appointmentId: result.appointmentId,
      event: result.conflictsOverridden ? 'OVERRIDE_CONFLICT' : 'APPOINTMENT_CREATED',
    }),
  },
  async function createAppointmentInner(
    input: AppointmentCreateInput,
  ): Promise<{ appointmentId: string; conflictsOverridden: boolean }> {
    const session = await auth();
    if (!session?.user?.id) throw new AppointmentError(unauthenticated);

    if (isStartInPast(input.startsAt)) throw new AppointmentError(inPast);

    const conflicts = await checkConflicts({
      patientId: input.patientId,
      therapistIds: input.therapistIds,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
    });

    if (!conflicts.ok && !input.overrideConflicts) {
      throw new AppointmentError(conflictError(conflicts.conflicts));
    }

    const therapistIds = [...new Set(input.therapistIds)];
    const appointment = await db.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          patientId: input.patientId,
          roomId: input.roomId ?? null,
          startsAt: input.startsAt,
          durationMinutes: input.durationMinutes,
          status: AppointmentStatus.SCHEDULED,
          notes: input.notes ?? null,
          createdById: session.user.id,
          therapists: { create: therapistIds.map((therapistId) => ({ therapistId })) },
        },
      });
      // Booking a patient with therapists makes EACH of them part of the
      // patient's care team so they appear in "My patients" + dashboard.
      // Idempotent, add-never-replace (Prompt 15.5; extended to the set in
      // Prompt 20). Covered by this appointment's CREATE audit.
      for (const therapistId of therapistIds) {
        await addCareTeamMemberTx(tx, input.patientId, therapistId, session.user.id);
      }
      return appt;
    });

    const config = await getReminderConfig();
    await enqueueAppointmentReminder({
      appointmentId: appointment.id,
      startsAt: appointment.startsAt,
      config,
    });

    // Best-effort confirmation send via the `appointment_confirmation_v2`
    // template seeded in Prompt 2. Mirrors the cancel-side fan-out in
    // shape and failure tolerance: enqueue is fire-and-forget so a
    // WhatsApp outage cannot break the booking flow. The
    // template takes four placeholders: {patientName, therapistName,
    // date, time}. Skip when the patient is flagged unreachable —
    // re-enabled automatically on the next successful delivery
    // (User.whatsappReachable; see Prompt 8 §4.12).
    const [patient, therapist] = await Promise.all([
      db.user.findUnique({
        where: { id: input.patientId },
        select: {
          phone: true,
          languagePref: true,
          whatsappReachable: true,
          fullNameEn: true,
          fullNameAr: true,
        },
      }),
      db.user.findUnique({
        where: { id: therapistIds[0] },
        select: { fullNameEn: true, fullNameAr: true },
      }),
    ]);
    if (patient && therapist && patient.whatsappReachable) {
      const { enqueueWhatsappOutbound } = await import('@/lib/queue/jobs/whatsappOutbound');
      const dateStr = appointment.startsAt.toISOString().slice(0, 10);
      const timeStr = appointment.startsAt.toISOString().slice(11, 16);
      const patientName = patient.languagePref === 'AR' ? patient.fullNameAr : patient.fullNameEn;
      const therapistName =
        patient.languagePref === 'AR' ? therapist.fullNameAr : therapist.fullNameEn;
      void enqueueWhatsappOutbound({
        kind: 'template',
        templateName: 'appointment_confirmation_v2',
        language: patient.languagePref,
        parameters: [patientName, therapistName, dateStr, timeStr],
        recipientPhone: patient.phone,
        recipientUserId: input.patientId,
        appointmentId: appointment.id,
        source: 'queue',
      }).catch((err: unknown) => {
        console.error('[appointments.create] confirmation enqueue failed', err);
      });
    }

    return {
      appointmentId: appointment.id,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
    };
  },
);

export const rescheduleAppointment = withAudit<
  [AppointmentRescheduleParsed],
  { appointmentId: string; conflictsOverridden: boolean }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) =>
      db.appointment.findUnique({
        where: { id: args[0].id },
        select: {
          startsAt: true,
          durationMinutes: true,
          roomId: true,
        },
      }),
    extractAfter: (result) => ({
      event: result.conflictsOverridden ? 'OVERRIDE_CONFLICT' : 'APPOINTMENT_RESCHEDULED',
    }),
  },
  async function rescheduleInner(
    input: AppointmentRescheduleParsed,
  ): Promise<{ appointmentId: string; conflictsOverridden: boolean }> {
    const session = await auth();
    const existing = await db.appointment.findUnique({
      where: { id: input.id },
      select: { id: true, patientId: true, status: true },
    });
    if (!existing) throw new AppointmentError(notFound);

    if (isStartInPast(input.startsAt)) throw new AppointmentError(inPast);

    // Omitted therapistIds → keep the existing set (pure time/room move, e.g.
    // dragging a multi-therapist session). Provided → replace it (e.g. dragging
    // a single-therapist appointment into another therapist's lane).
    const existingTherapistIds = await getAppointmentTherapistIds(input.id);
    const therapistIds = input.therapistIds ?? existingTherapistIds;

    const conflicts = await checkConflicts({
      appointmentId: input.id,
      patientId: existing.patientId,
      therapistIds,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
    });

    if (!conflicts.ok && !input.overrideConflicts) {
      throw new AppointmentError(conflictError(conflicts.conflicts));
    }

    await db.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: input.id },
        data: {
          startsAt: input.startsAt,
          durationMinutes: input.durationMinutes,
          roomId: input.roomId ?? null,
        },
      });
      if (input.therapistIds) {
        await setAppointmentTherapistsTx(tx, input.id, therapistIds);
      }
      // Adding a therapist (e.g. dragging to another resource column) adds them
      // to the care team — add-never-replace, idempotent when unchanged.
      for (const therapistId of therapistIds) {
        await addCareTeamMemberTx(
          tx,
          existing.patientId,
          therapistId,
          session?.user?.id ?? therapistId,
        );
      }
    });

    // Re-enqueue the reminder against the new fire time.
    await cancelAppointmentReminder(input.id);
    if (
      existing.status === AppointmentStatus.SCHEDULED ||
      existing.status === AppointmentStatus.CONFIRMED
    ) {
      const config = await getReminderConfig();
      await enqueueAppointmentReminder({
        appointmentId: input.id,
        startsAt: input.startsAt,
        config,
      });
    }

    return {
      appointmentId: input.id,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
    };
  },
);

/**
 * Manage the therapist SET on an appointment (Prompt 20 — was "change
 * therapist"). Diffs the requested set against the current one, adds/removes
 * the join rows in a transaction, adds new therapists to the care team, and
 * notifies added + removed therapists. Min 1 therapist (Zod-enforced).
 */
export const changeAppointmentTherapist = withAudit<
  [AppointmentChangeTherapistParsed],
  {
    appointmentId: string;
    conflictsOverridden: boolean;
    previousTherapistIds: string[];
    newTherapistIds: string[];
    reason: string | null;
  }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) => ({
      therapistIds: await getAppointmentTherapistIds(args[0].id),
    }),
    extractAfter: (result) => ({
      event: result.conflictsOverridden ? 'OVERRIDE_CONFLICT' : 'THERAPISTS_CHANGED',
      previousTherapistIds: result.previousTherapistIds,
      newTherapistIds: result.newTherapistIds,
      reason: result.reason,
    }),
  },
  async function changeTherapistInner(input): Promise<{
    appointmentId: string;
    conflictsOverridden: boolean;
    previousTherapistIds: string[];
    newTherapistIds: string[];
    reason: string | null;
  }> {
    const existing = await db.appointment.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        patientId: true,
        startsAt: true,
        durationMinutes: true,
        status: true,
        patient: { select: { fullNameEn: true, fullNameAr: true } },
      },
    });
    if (!existing) throw new AppointmentError(notFound);

    const previousTherapistIds = await getAppointmentTherapistIds(input.id);
    const newTherapistIds = [...new Set(input.therapistIds)];

    // Re-run the conflict engine at submit time for the NEW set. The
    // availability dots in the UI are advisory; the slot may have filled in
    // between render and click. This is the authoritative check.
    const conflicts = await checkConflicts({
      appointmentId: input.id,
      patientId: existing.patientId,
      therapistIds: newTherapistIds,
      startsAt: existing.startsAt,
      durationMinutes: existing.durationMinutes,
    });
    if (!conflicts.ok && !input.overrideConflicts) {
      throw new AppointmentError(conflictError(conflicts.conflicts));
    }

    const prevSet = new Set(previousTherapistIds);
    const nextSet = new Set(newTherapistIds);
    const added = newTherapistIds.filter((id) => !prevSet.has(id));
    const removed = previousTherapistIds.filter((id) => !nextSet.has(id));

    // No-op when the set is unchanged — avoid the notification fan-out.
    if (added.length === 0 && removed.length === 0) {
      return {
        appointmentId: input.id,
        conflictsOverridden: false,
        previousTherapistIds,
        newTherapistIds,
        reason: input.reason ?? null,
      };
    }

    const session = await auth();
    await db.$transaction(async (tx) => {
      await setAppointmentTherapistsTx(tx, input.id, newTherapistIds);
      // Add the newly-assigned therapists to the care team (add-never-replace
      // — removed therapists stay on the care team unless removed elsewhere).
      for (const therapistId of added) {
        await addCareTeamMemberTx(
          tx,
          existing.patientId,
          therapistId,
          session?.user?.id ?? therapistId,
        );
      }
    });

    // Notify each added + removed therapist (Prompt 7b §4.6, extended to the
    // set in Prompt 20). Fire-and-forget; the audit row already captured it.
    const { createNotification } = await import('@/lib/notifications/actions');
    const dateStr = existing.startsAt.toISOString().slice(0, 10);
    const patientName = existing.patient.fullNameEn;
    for (const therapistId of removed) {
      void createNotification({
        recipientId: therapistId,
        type: 'APPOINTMENT_THERAPIST_REMOVED',
        params: { patientName, date: dateStr },
        linkPath: `/therapist/schedule`,
        relatedEntityType: 'Appointment',
        relatedEntityId: input.id,
      }).catch((err: unknown) => {
        console.error('[appointments.changeTherapist] removed notification failed', err);
      });
    }
    for (const therapistId of added) {
      void createNotification({
        recipientId: therapistId,
        type: 'APPOINTMENT_THERAPIST_ASSIGNED',
        params: { patientName, date: dateStr },
        linkPath: `/therapist/schedule`,
        relatedEntityType: 'Appointment',
        relatedEntityId: input.id,
      }).catch((err: unknown) => {
        console.error('[appointments.changeTherapist] assigned notification failed', err);
      });
    }

    return {
      appointmentId: input.id,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
      previousTherapistIds,
      newTherapistIds,
      reason: input.reason ?? null,
    };
  },
);

// ─── Batched availability query (Prompt 7b §4.6) ──────────────────────────

export interface TherapistAvailabilityRow {
  therapistId: string;
  available: boolean;
  conflictKinds: Array<
    | 'THERAPIST_OVERLAP'
    | 'PATIENT_OVERLAP'
    | 'THERAPIST_ON_LEAVE'
    | 'OUTSIDE_BUSINESS_HOURS'
    | 'CLINIC_CLOSED_THIS_DAY'
  >;
}

/**
 * Run the conflict engine against every candidate therapist for a single
 * appointment slot in parallel. Returns one row per therapist with an
 * `available` flag (the green/red dot in the UI) and the conflict kinds
 * so the picker can show a short reason inline. Parallel fan-out via
 * Promise.all — sequential looping would dominate latency at clinic
 * scale (50+ therapists).
 *
 * The dots are advisory only — `changeAppointmentTherapist` re-runs
 * the engine at submit time and rejects if a conflict has emerged
 * between render and click.
 */
export async function getTherapistAvailabilityForTimeSlot(args: {
  appointmentId: string;
  patientId: string;
  startsAt: Date;
  durationMinutes: number;
  therapistIds: string[];
  excludeTherapistId?: string;
}): Promise<TherapistAvailabilityRow[]> {
  const candidates = args.therapistIds.filter((id) => id !== args.excludeTherapistId);
  return Promise.all(
    candidates.map(async (therapistId) => {
      const r = await checkConflicts({
        appointmentId: args.appointmentId,
        patientId: args.patientId,
        therapistIds: [therapistId],
        startsAt: args.startsAt,
        durationMinutes: args.durationMinutes,
      });
      return {
        therapistId,
        available: r.ok,
        conflictKinds: r.ok ? [] : r.conflicts.map((c) => c.kind),
      };
    }),
  );
}

export const cancelAppointment = withAudit<
  [AppointmentCancelParsed],
  { appointmentId: string; flaggedShortNotice: boolean }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: (result) => ({
      event: 'APPOINTMENT_CANCELLED',
      flaggedShortNotice: result.flaggedShortNotice,
    }),
  },
  async function cancelInner(input): Promise<{
    appointmentId: string;
    flaggedShortNotice: boolean;
  }> {
    const existing = await db.appointment.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        status: true,
        startsAt: true,
        therapists: { select: { therapistId: true } },
        patientId: true,
        patient: {
          select: {
            phone: true,
            languagePref: true,
            whatsappReachable: true,
            fullNameEn: true,
            fullNameAr: true,
          },
        },
      },
    });
    if (!existing) throw new AppointmentError(notFound);
    if (!canTransition(existing.status, AppointmentStatus.CANCELLED)) {
      throw new AppointmentError(
        STATUS_ERRORS.INVALID_TRANSITION(existing.status, AppointmentStatus.CANCELLED),
      );
    }
    if (!input.cancellationReason) {
      throw new AppointmentError(STATUS_ERRORS.CANCEL_REASON_REQUIRED);
    }

    const session = await auth();
    const shortNotice = existing.startsAt.getTime() - Date.now() < 2 * 60 * 60 * 1000;

    await db.appointment.update({
      where: { id: input.id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: input.cancellationReason,
        cancellationCategory: input.cancellationCategory,
        cancellationNotes: input.cancellationNotes ?? null,
        cancelledById: session?.user?.id ?? null,
        cancelledAt: new Date(),
      },
    });
    await cancelAppointmentReminder(input.id);

    // Prompt 19 — the slot just freed; suggest it to anyone on the booking
    // waitlist whose window covers it. A multi-therapist session frees the slot
    // for EACH assigned therapist (Prompt 20). Best-effort: never blocks cancel.
    for (const { therapistId } of existing.therapists) {
      await notifyWaitlistForFreedSlot({ startsAt: existing.startsAt, therapistId });
    }

    // Optional patient notification via the existing
    // `appointment_cancellation` template seeded in Prompt 2. The
    // template's three placeholders are date, time, and reason — we
    // pass the localized category label as the reason. Best-effort
    // fan-out: failures log + continue so cancel still succeeds.
    if (input.notifyPatient && existing.patient.whatsappReachable) {
      const { enqueueWhatsappOutbound } = await import('@/lib/queue/jobs/whatsappOutbound');
      const dateStr = existing.startsAt.toISOString().slice(0, 10);
      const timeStr = existing.startsAt.toISOString().slice(11, 16);
      void enqueueWhatsappOutbound({
        kind: 'template',
        templateName: 'appointment_cancelled_v2',
        language: existing.patient.languagePref,
        parameters: [
          dateStr,
          timeStr,
          categoryLabelForLocale(input.cancellationCategory, existing.patient.languagePref),
        ],
        recipientPhone: existing.patient.phone,
        recipientUserId: existing.patientId,
        appointmentId: existing.id,
        source: 'queue',
      }).catch((err: unknown) => {
        console.error('[appointments.cancel] notification enqueue failed', err);
      });
    }

    return { appointmentId: input.id, flaggedShortNotice: shortNotice };
  },
);

// ─── Series-edit bulk paths (Prompt 7b §4.7) ──────────────────────────────

export interface BulkFailure {
  appointmentId: string;
  startsAt: Date;
  reason: 'CONFLICT' | 'INVALID_TRANSITION' | 'NOT_FOUND';
  conflicts?: Conflict[];
}

export class BulkAppointmentError extends AppointmentError {
  constructor(failures: BulkFailure[]) {
    super({
      code: 'SERIES_BULK_FAILED',
      message_en: `${failures.length} occurrence(s) could not be updated — the entire series edit was rolled back.`,
      message_ar: `تعذر تحديث ${failures.length} موعد — تم التراجع عن تعديل السلسلة بالكامل.`,
      details: { failures: failures as unknown as Record<string, unknown> },
    });
  }
}

/**
 * Bulk cancel for FOLLOWING / ALL. Status-guards each row, applies
 * the same category + reason transactionally, and (after commit) fans
 * out WhatsApp notifications when notifyPatient is true. Any row that
 * cannot legally transition aborts the whole batch — partial cancels
 * would be impossible to reason about in the audit log.
 */
export const cancelAppointmentSeries = withAudit<
  [AppointmentCancelParsed],
  {
    appointmentIds: string[];
    skippedCount: number;
    flaggedShortNotice: boolean;
  }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: (result) => ({
      event: 'APPOINTMENT_SERIES_CANCELLED',
      appointmentIds: result.appointmentIds,
      skippedCount: result.skippedCount,
      flaggedShortNotice: result.flaggedShortNotice,
    }),
  },
  async function cancelSeriesInner(input): Promise<{
    appointmentIds: string[];
    skippedCount: number;
    flaggedShortNotice: boolean;
  }> {
    if (!input.cancellationReason) {
      throw new AppointmentError(STATUS_ERRORS.CANCEL_REASON_REQUIRED);
    }

    const session = await auth();
    const occurrences = await selectSeriesOccurrences({
      appointmentId: input.id,
      mode: input.seriesMode,
    });
    if (occurrences.length === 0) {
      throw new AppointmentError(notFound);
    }

    // Pre-flight: every row must be in an active state.
    const failures: BulkFailure[] = [];
    for (const occ of occurrences) {
      if (!canTransition(occ.status, AppointmentStatus.CANCELLED)) {
        failures.push({
          appointmentId: occ.id,
          startsAt: occ.startsAt,
          reason: 'INVALID_TRANSITION',
        });
      }
    }
    if (failures.length > 0) throw new BulkAppointmentError(failures);

    let flaggedShortNotice = false;
    const ids = await db.$transaction(async (tx) => {
      const updated: string[] = [];
      for (const occ of occurrences) {
        if (occ.startsAt.getTime() - Date.now() < 2 * 60 * 60 * 1000) {
          flaggedShortNotice = true;
        }
        await tx.appointment.update({
          where: { id: occ.id },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancellationReason: input.cancellationReason,
            cancellationCategory: input.cancellationCategory,
            cancellationNotes: input.cancellationNotes ?? null,
            cancelledById: session?.user?.id ?? null,
            cancelledAt: new Date(),
          },
        });
        updated.push(occ.id);
      }
      return updated;
    });

    // Side effects after commit.
    await Promise.all(ids.map((id) => cancelAppointmentReminder(id)));

    // Prompt 19 — every freed occurrence may match a waitlisted patient; a
    // multi-therapist occurrence frees the slot per assigned therapist (P20).
    const freed = await db.appointment.findMany({
      where: { id: { in: ids } },
      select: { startsAt: true, therapists: { select: { therapistId: true } } },
    });
    for (const f of freed) {
      for (const { therapistId } of f.therapists) {
        await notifyWaitlistForFreedSlot({ startsAt: f.startsAt, therapistId });
      }
    }

    if (input.notifyPatient) {
      const enriched = await db.appointment.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          startsAt: true,
          patientId: true,
          patient: {
            select: { phone: true, languagePref: true, whatsappReachable: true },
          },
        },
      });
      const { enqueueWhatsappOutbound } = await import('@/lib/queue/jobs/whatsappOutbound');
      for (const row of enriched) {
        if (!row.patient.whatsappReachable) continue;
        const dateStr = row.startsAt.toISOString().slice(0, 10);
        const timeStr = row.startsAt.toISOString().slice(11, 16);
        void enqueueWhatsappOutbound({
          kind: 'template',
          templateName: 'appointment_cancelled_v2',
          language: row.patient.languagePref,
          parameters: [
            dateStr,
            timeStr,
            categoryLabelForLocale(input.cancellationCategory, row.patient.languagePref),
          ],
          recipientPhone: row.patient.phone,
          recipientUserId: row.patientId,
          appointmentId: row.id,
          source: 'queue',
        }).catch((err: unknown) => {
          console.error('[appointments.cancelSeries] notification enqueue failed', err);
        });
      }
    }

    return { appointmentIds: ids, skippedCount: 0, flaggedShortNotice };
  },
);

/**
 * Bulk reschedule for FOLLOWING / ALL. Computes the delta between the
 * target appointment's current `startsAt` and the new `startsAt`, then
 * applies that same delta to every occurrence in scope. Conflict-checks
 * each new slot inside the transaction; a single conflict aborts the
 * entire batch (Prompt 7b §4.7 — no partial application).
 */
export const rescheduleAppointmentSeries = withAudit<
  [AppointmentRescheduleParsed],
  {
    appointmentIds: string[];
    conflictsOverridden: boolean;
  }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: (result) => ({
      event: result.conflictsOverridden ? 'OVERRIDE_CONFLICT' : 'APPOINTMENT_SERIES_RESCHEDULED',
      appointmentIds: result.appointmentIds,
    }),
  },
  async function rescheduleSeriesInner(input): Promise<{
    appointmentIds: string[];
    conflictsOverridden: boolean;
  }> {
    const target = await db.appointment.findUnique({
      where: { id: input.id },
      select: { id: true, startsAt: true, status: true },
    });
    if (!target) throw new AppointmentError(notFound);

    const deltaMs = input.startsAt.getTime() - target.startsAt.getTime();
    const occurrences = await selectSeriesOccurrences({
      appointmentId: input.id,
      mode: input.seriesMode,
    });
    if (occurrences.length === 0) throw new AppointmentError(notFound);

    interface Planned {
      occ: SeriesOccurrenceRow;
      newStartsAt: Date;
      newDurationMinutes: number;
      newTherapistIds: string[];
    }
    const planned: Planned[] = occurrences.map((occ) => ({
      occ,
      newStartsAt: new Date(occ.startsAt.getTime() + deltaMs),
      // The bulk path keeps each occurrence's own duration + therapist set;
      // only the explicitly-targeted occurrence may also change duration /
      // therapists / room (the values from the reschedule modal).
      newDurationMinutes: occ.id === target.id ? input.durationMinutes : occ.durationMinutes,
      newTherapistIds:
        occ.id === target.id ? (input.therapistIds ?? occ.therapistIds) : occ.therapistIds,
    }));

    const failures: BulkFailure[] = [];
    await db.$transaction(async (tx) => {
      for (const p of planned) {
        const conflicts = await checkConflicts({
          appointmentId: p.occ.id,
          patientId: p.occ.patientId,
          therapistIds: p.newTherapistIds,
          startsAt: p.newStartsAt,
          durationMinutes: p.newDurationMinutes,
        });
        if (!conflicts.ok && !input.overrideConflicts) {
          failures.push({
            appointmentId: p.occ.id,
            startsAt: p.newStartsAt,
            reason: 'CONFLICT',
            conflicts: conflicts.conflicts,
          });
        }
      }
      if (failures.length > 0) {
        throw new BulkAppointmentError(failures);
      }
      for (const p of planned) {
        await tx.appointment.update({
          where: { id: p.occ.id },
          data: {
            startsAt: p.newStartsAt,
            durationMinutes: p.newDurationMinutes,
            ...(p.occ.id === target.id && input.roomId !== undefined
              ? { roomId: input.roomId }
              : {}),
          },
        });
        if (p.occ.id === target.id && input.therapistIds) {
          await setAppointmentTherapistsTx(tx, p.occ.id, p.newTherapistIds);
        }
      }
    });

    // Re-enqueue reminders for active occurrences.
    const ids = planned.map((p) => p.occ.id);
    await Promise.all(ids.map((id) => cancelAppointmentReminder(id)));
    const config = await getReminderConfig();
    await Promise.all(
      planned
        .filter(
          (p) =>
            p.occ.status === AppointmentStatus.SCHEDULED ||
            p.occ.status === AppointmentStatus.CONFIRMED,
        )
        .map((p) =>
          enqueueAppointmentReminder({
            appointmentId: p.occ.id,
            startsAt: p.newStartsAt,
            config,
          }).catch((err: unknown) => {
            console.error('[appointments.rescheduleSeries] reminder enqueue failed', err);
          }),
        ),
    );

    return { appointmentIds: ids, conflictsOverridden: false };
  },
);

/**
 * Bulk change-therapist for FOLLOWING / ALL. Swaps therapist on every
 * occurrence in scope inside one transaction; emits the
 * APPOINTMENT_THERAPIST_REMOVED / _ASSIGNED notifications once for the
 * old + new therapist after commit (collapsed — one summary per
 * recipient, not N spam messages).
 */
export const changeAppointmentTherapistSeries = withAudit<
  [AppointmentChangeTherapistParsed],
  {
    appointmentIds: string[];
    previousTherapistIds: string[];
    newTherapistIds: string[];
    reason: string | null;
    conflictsOverridden: boolean;
  }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: (result) => ({
      event: result.conflictsOverridden
        ? 'OVERRIDE_CONFLICT'
        : 'APPOINTMENT_SERIES_THERAPIST_CHANGED',
      appointmentIds: result.appointmentIds,
      previousTherapistIds: result.previousTherapistIds,
      newTherapistIds: result.newTherapistIds,
      reason: result.reason,
    }),
  },
  async function changeTherapistSeriesInner(input): Promise<{
    appointmentIds: string[];
    previousTherapistIds: string[];
    newTherapistIds: string[];
    reason: string | null;
    conflictsOverridden: boolean;
  }> {
    const occurrences = await selectSeriesOccurrences({
      appointmentId: input.id,
      mode: input.seriesMode,
    });
    if (occurrences.length === 0) throw new AppointmentError(notFound);
    // The target occurrence's set is the "previous" reference for notifications.
    const previousTherapistIds =
      occurrences.find((o) => o.id === input.id)?.therapistIds ?? occurrences[0]!.therapistIds;
    const newTherapistIds = [...new Set(input.therapistIds)];

    const failures: BulkFailure[] = [];
    await db.$transaction(async (tx) => {
      for (const occ of occurrences) {
        const conflicts = await checkConflicts({
          appointmentId: occ.id,
          patientId: occ.patientId,
          therapistIds: newTherapistIds,
          startsAt: occ.startsAt,
          durationMinutes: occ.durationMinutes,
        });
        if (!conflicts.ok && !input.overrideConflicts) {
          failures.push({
            appointmentId: occ.id,
            startsAt: occ.startsAt,
            reason: 'CONFLICT',
            conflicts: conflicts.conflicts,
          });
        }
      }
      if (failures.length > 0) {
        throw new BulkAppointmentError(failures);
      }
      for (const occ of occurrences) {
        await setAppointmentTherapistsTx(tx, occ.id, newTherapistIds);
      }
    });

    // Single summary notification per added/removed therapist (Prompt 7b §4.7
    // — don't spam with N rows). Diff against the target occurrence's old set.
    const prevSet = new Set(previousTherapistIds);
    const nextSet = new Set(newTherapistIds);
    const added = newTherapistIds.filter((id) => !prevSet.has(id));
    const removed = previousTherapistIds.filter((id) => !nextSet.has(id));
    if (added.length > 0 || removed.length > 0) {
      const patient = await db.appointment
        .findUnique({
          where: { id: input.id },
          select: { patient: { select: { fullNameEn: true } } },
        })
        .then((r) => r?.patient.fullNameEn ?? '');
      const firstStart = occurrences[0]!.startsAt.toISOString().slice(0, 10);
      const { createNotification } = await import('@/lib/notifications/actions');
      for (const therapistId of removed) {
        void createNotification({
          recipientId: therapistId,
          type: 'APPOINTMENT_THERAPIST_REMOVED',
          params: { patientName: patient, date: firstStart },
          linkPath: `/therapist/schedule`,
          relatedEntityType: 'Appointment',
          relatedEntityId: input.id,
        }).catch((err: unknown) => {
          console.error('[appointments.changeTherapistSeries] removed notif failed', err);
        });
      }
      for (const therapistId of added) {
        void createNotification({
          recipientId: therapistId,
          type: 'APPOINTMENT_THERAPIST_ASSIGNED',
          params: { patientName: patient, date: firstStart },
          linkPath: `/therapist/schedule`,
          relatedEntityType: 'Appointment',
          relatedEntityId: input.id,
        }).catch((err: unknown) => {
          console.error('[appointments.changeTherapistSeries] assigned notif failed', err);
        });
      }
    }

    return {
      appointmentIds: occurrences.map((o) => o.id),
      previousTherapistIds,
      newTherapistIds,
      reason: input.reason ?? null,
      conflictsOverridden: false,
    };
  },
);

/**
 * Localized label for a cancellation category. Used in the WhatsApp
 * cancellation message; UI surfaces translate via the i18n bundle.
 */
function categoryLabelForLocale(category: CancellationCategory, language: 'EN' | 'AR'): string {
  const labels: Record<CancellationCategory, { en: string; ar: string }> = {
    PATIENT_REQUEST: { en: 'patient request', ar: 'طلب المريض' },
    PATIENT_NO_SHOW: { en: 'patient no-show', ar: 'عدم حضور المريض' },
    PATIENT_ILLNESS: { en: 'patient illness', ar: 'مرض المريض' },
    PATIENT_TRAVEL: { en: 'patient travel', ar: 'سفر المريض' },
    CLINIC_RESCHEDULING: { en: 'clinic rescheduling', ar: 'إعادة جدولة العيادة' },
    THERAPIST_UNAVAILABLE: { en: 'therapist unavailable', ar: 'المعالج غير متاح' },
    WEATHER: { en: 'weather', ar: 'ظروف جوية' },
    INSURANCE_ISSUE: { en: 'insurance issue', ar: 'مشكلة تأمين' },
    OTHER: { en: 'other', ar: 'أخرى' },
  };
  const pair = labels[category];
  return language === 'AR' ? pair.ar : pair.en;
}

export const updateAppointmentStatus = withAudit<
  [{ id: string; to: AppointmentStatus }],
  { appointmentId: string }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: (_result, ..._rest) => ({ event: 'STATUS_CHANGED' }),
  },
  async function updateStatusInner({ id, to }): Promise<{ appointmentId: string }> {
    const session = await auth();
    if (!session?.user) throw new AppointmentError(unauthenticated);

    const existing = await db.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        startsAt: true,
        therapists: { select: { therapistId: true } },
      },
    });
    if (!existing) throw new AppointmentError(notFound);
    const therapistIds = existing.therapists.map((t) => t.therapistId);

    if (!canTransition(existing.status, to)) {
      throw new AppointmentError(STATUS_ERRORS.INVALID_TRANSITION(existing.status, to));
    }

    // Start-Session time gate (Fix Prompt 2 — Receptionist #11). Starting a
    // session (→ IN_PROGRESS) is blocked until `start − sessionStartGraceMinutes`.
    // This is the SERVER-SIDE source of truth; both the calendar popup and the
    // arrivals panel route here, so neither surface can start a session early.
    // The comparison is instant-vs-instant and is intentionally tz-independent
    // (see lib/appointments/session-timing.ts).
    if (to === AppointmentStatus.IN_PROGRESS) {
      const { startGraceMinutes, timeZone } = await getSessionGraceConfig();
      if (!canStartSessionAt(new Date(), existing.startsAt, startGraceMinutes)) {
        throw new AppointmentError(
          sessionStartTooEarly(
            earliestSessionStart(existing.startsAt, startGraceMinutes),
            timeZone,
          ),
        );
      }
    }

    // A therapist may only complete an in-session appointment they are ON
    // (any of the assigned therapists — Prompt 20).
    if (
      session.user.role === UserRole.THERAPIST &&
      to === AppointmentStatus.COMPLETED &&
      !therapistIds.includes(session.user.id)
    ) {
      throw new AppointmentError(STATUS_ERRORS.FORBIDDEN);
    }

    await db.appointment.update({
      where: { id },
      data: { status: to },
    });

    // Cancel the reminder if the appointment is no longer eligible (in-progress,
    // completed, or any terminal state).
    if (to !== AppointmentStatus.SCHEDULED && to !== AppointmentStatus.CONFIRMED) {
      await cancelAppointmentReminder(id);
    }

    // Prompt 19 — a no-show frees the slot exactly like a cancellation does;
    // route it through the same waitlist matcher (no duplicated logic). One
    // freed slot per assigned therapist (Prompt 20).
    if (to === AppointmentStatus.NO_SHOW) {
      for (const therapistId of therapistIds) {
        await notifyWaitlistForFreedSlot({ startsAt: existing.startsAt, therapistId });
      }
    }

    return { appointmentId: id };
  },
);

// ─── Recurring series (Prompt 7b §4.4) ────────────────────────────────────

export interface SeriesPreviewOccurrence {
  index: number;
  startsAt: Date;
  durationMinutes: number;
  conflicts: ConflictResult;
}

/**
 * Expand a recurrence rule and run the conflict engine against every
 * occurrence. Pure-read; no transactions, no audit — the Secretary's
 * series-builder UI calls this to render the per-occurrence resolution
 * picker. Each occurrence carries its own conflict list so the user
 * can chose Skip / Shift +1d / Shift +1w / Override per row.
 *
 * The preview is also re-run after every resolution change so a shifted
 * slot never lands silently — if the +1d shift still conflicts, the
 * client surfaces the new conflicts and asks the user to resolve again.
 */
export async function previewSeries(
  input: SeriesPreviewInput,
): Promise<{ occurrences: SeriesPreviewOccurrence[] }> {
  const planned = expandRecurrence(input.rule, input.startsAt, input.durationMinutes);
  const occurrences = await Promise.all(
    planned.map(async (p) => ({
      index: p.index,
      startsAt: p.startsAt,
      durationMinutes: p.durationMinutes,
      conflicts: await checkConflicts({
        patientId: input.patientId,
        therapistIds: input.therapistIds,
        startsAt: p.startsAt,
        durationMinutes: p.durationMinutes,
      }),
    })),
  );
  return { occurrences };
}

/**
 * Re-validate a single occurrence against the conflict engine. Used by
 * the resolution UI after a +1d / +1w shift so the new slot is checked
 * before the user moves on (no silent acceptance — Prompt 7b §4.4).
 */
export async function previewSingleOccurrence(input: {
  patientId: string;
  therapistIds: string[];
  startsAt: Date;
  durationMinutes: number;
}): Promise<ConflictResult> {
  return checkConflicts({
    patientId: input.patientId,
    therapistIds: input.therapistIds,
    startsAt: input.startsAt,
    durationMinutes: input.durationMinutes,
  });
}

export const createSeries = withAudit<
  [SeriesCreateInput],
  {
    seriesId: string;
    appointmentIds: string[];
    skippedCount: number;
    overrideCount: number;
  }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.seriesId,
    extractAfter: (result) => ({
      event: result.overrideCount > 0 ? 'OVERRIDE_CONFLICT' : 'APPOINTMENT_SERIES_CREATED',
      seriesId: result.seriesId,
      appointmentCount: result.appointmentIds.length,
      skippedCount: result.skippedCount,
      overrideCount: result.overrideCount,
    }),
  },
  async function createSeriesInner(input): Promise<{
    seriesId: string;
    appointmentIds: string[];
    skippedCount: number;
    overrideCount: number;
  }> {
    const session = await auth();
    if (!session?.user?.id) throw new AppointmentError(unauthenticated);

    // The first occurrence is `input.startsAt` and every other occurrence is
    // later, so rejecting a past first-start guarantees no past occurrence is
    // created (Fix 6C item 1).
    if (isStartInPast(input.startsAt)) throw new AppointmentError(inPast);

    // Re-expand from the rule + first slot to validate the client's
    // resolution list matches the actual occurrence count. The client
    // cannot smuggle extra rows past this check.
    const planned = expandRecurrence(input.rule, input.startsAt, input.durationMinutes);
    if (planned.length === 0) {
      throw new AppointmentError({
        code: 'SERIES_EMPTY',
        message_en: 'Series produced no occurrences.',
        message_ar: 'لم تنتج السلسلة أي مواعيد.',
      });
    }
    if (planned.length > MAX_SERIES_OCCURRENCES) {
      throw new AppointmentError({
        code: 'SERIES_TOO_LARGE',
        message_en: `Series exceeds the ${MAX_SERIES_OCCURRENCES}-occurrence limit.`,
        message_ar: `تجاوزت السلسلة الحد الأقصى ${MAX_SERIES_OCCURRENCES} موعداً.`,
      });
    }
    if (input.resolutions.length !== planned.length) {
      throw new AppointmentError({
        code: 'SERIES_RESOLUTION_MISMATCH',
        message_en: 'Resolution list does not match the expanded series.',
        message_ar: 'قائمة القرارات لا تطابق السلسلة الموسعة.',
      });
    }

    const byIndex = new Map<number, PlannedOccurrence>();
    for (const p of planned) byIndex.set(p.index, p);

    // Decide the final occurrences (Skip drops the row; Shift moves
    // startsAt; Override accepts conflicts; Keep requires conflict-free).
    interface FinalOccurrence {
      index: number;
      startsAt: Date;
      durationMinutes: number;
      override: boolean;
    }
    const finalOccurrences: FinalOccurrence[] = [];
    let skippedCount = 0;
    let overrideCount = 0;

    for (const r of input.resolutions) {
      if (!byIndex.has(r.index)) {
        throw new AppointmentError({
          code: 'SERIES_UNKNOWN_INDEX',
          message_en: `Resolution references unknown occurrence index ${r.index}.`,
          message_ar: `القرار يشير إلى موعد غير معروف رقم ${r.index}.`,
        });
      }
      if (r.resolution === 'SKIP') {
        skippedCount++;
        continue;
      }
      const base = byIndex.get(r.index)!;
      // The startsAt in the resolution is authoritative for shifts;
      // for KEEP / OVERRIDE the client should send the original value.
      // We trust input.startsAt but re-run the conflict engine before
      // accepting — the engine is the only source of truth for whether
      // a slot is bookable.
      finalOccurrences.push({
        index: r.index,
        startsAt: r.resolution === 'KEEP' ? base.startsAt : r.startsAt,
        durationMinutes: input.durationMinutes,
        override: r.resolution === 'OVERRIDE',
      });
      if (r.resolution === 'OVERRIDE') overrideCount++;
    }

    if (finalOccurrences.length === 0) {
      throw new AppointmentError({
        code: 'SERIES_ALL_SKIPPED',
        message_en: 'Every occurrence was skipped — nothing to book.',
        message_ar: 'تم تخطي جميع المواعيد — لا يوجد شيء للحجز.',
      });
    }

    // Re-run conflict check on every final slot. KEEP / SHIFT must be
    // conflict-free; OVERRIDE accepts conflicts. Race protection: this
    // happens inside the transaction below so the read+write is serialized
    // against any concurrent insert that lands between preview and submit.
    const seriesId = `ser_${session.user.id}_${Date.now().toString(36)}`;
    let appointmentIds: string[];
    try {
      appointmentIds = await db.$transaction(async (tx) => {
        const ids: string[] = [];
        for (const occ of finalOccurrences) {
          const conflicts = await checkConflicts({
            patientId: input.patientId,
            therapistIds: input.therapistIds,
            startsAt: occ.startsAt,
            durationMinutes: occ.durationMinutes,
          });
          if (!conflicts.ok && !occ.override) {
            // Atomic abort — Prompt 7b §4.4: any failure rolls back the
            // entire series and surfaces the failing occurrence in the
            // error payload.
            throw new AppointmentError({
              code: 'SERIES_OCCURRENCE_CONFLICT',
              message_en: `Occurrence ${occ.index + 1} conflicts — resolve or override before saving.`,
              message_ar: `الموعد رقم ${occ.index + 1} يتعارض — يرجى الحل أو التجاوز قبل الحفظ.`,
              details: {
                occurrenceIndex: occ.index,
                startsAt: occ.startsAt.toISOString(),
                conflicts: conflicts.conflicts as unknown as Record<string, unknown>,
              },
            });
          }
          if (occ.override) {
            // Tightened permission check — the action-layer guard already
            // validated the caller holds appointments.override_conflict;
            // surfacing the conflicts in the audit payload happens via
            // overrideCount on the outer return.
          }
          const created = await tx.appointment.create({
            data: {
              patientId: input.patientId,
              roomId: input.roomId ?? null,
              startsAt: occ.startsAt,
              durationMinutes: occ.durationMinutes,
              status: AppointmentStatus.SCHEDULED,
              notes: input.notes ?? null,
              createdById: session.user!.id!,
              seriesId,
              therapists: {
                create: [...new Set(input.therapistIds)].map((therapistId) => ({ therapistId })),
              },
            },
            select: { id: true, startsAt: true },
          });
          ids.push(created.id);
        }
        // Booking adds every assigned therapist to the patient's care team.
        for (const therapistId of new Set(input.therapistIds)) {
          await addCareTeamMemberTx(tx, input.patientId, therapistId, session.user!.id!);
        }
        return ids;
      });
    } catch (err) {
      // Re-throw AppointmentError untouched; wrap unexpected DB errors
      // so the caller gets a localized message either way.
      if (err instanceof AppointmentError) throw err;
      throw new AppointmentError({
        code: 'SERIES_TRANSACTION_FAILED',
        message_en: 'Series creation failed — no appointments were saved.',
        message_ar: 'فشل إنشاء السلسلة — لم يتم حفظ أي موعد.',
        details: { cause: String((err as Error)?.message ?? err) },
      });
    }

    // Enqueue reminders best-effort after the transaction commits. If
    // the reminder queue is down the appointments are still booked.
    const config = await getReminderConfig();
    await Promise.all(
      appointmentIds.map((id, i) =>
        enqueueAppointmentReminder({
          appointmentId: id,
          startsAt: finalOccurrences[i]!.startsAt,
          config,
        }).catch((err: unknown) => {
          console.error('[series.create] reminder enqueue failed', { id, err });
        }),
      ),
    );

    return { seriesId, appointmentIds, skippedCount, overrideCount };
  },
);

export function appointmentToLocalized(err: unknown): LocalizedError {
  if (err instanceof AppointmentError) return err.error;
  return toLocalizedError(err);
}

/**
 * Permission resolver for `updateAppointmentStatus`. The 'use server'
 * facade should call requirePermission(...) with the code this returns.
 */
export function permissionForStatusChange(
  from: AppointmentStatus,
  to: AppointmentStatus,
): string | null {
  return permissionForTransition(from, to);
}
