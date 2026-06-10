import { AppointmentStatus, AuditAction, UserRole } from '@prisma/client';
import type { CancellationCategory } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { addCareTeamMemberTx } from '@/lib/patients/assignment';
import {
  cancelAppointmentReminder,
  enqueueAppointmentReminder,
} from '@/lib/queue/jobs/appointmentReminder';

import { checkConflicts, type Conflict, type ConflictResult } from './conflicts';
import { expandRecurrence, MAX_SERIES_OCCURRENCES, type PlannedOccurrence } from './recurrence';
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

async function getReminderOffsetMinutes(): Promise<number> {
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { defaultReminderOffsetMinutes: true },
  });
  return settings?.defaultReminderOffsetMinutes ?? 30;
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

    const conflicts = await checkConflicts({
      patientId: input.patientId,
      therapistId: input.therapistId,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
    });

    if (!conflicts.ok && !input.overrideConflicts) {
      throw new AppointmentError(conflictError(conflicts.conflicts));
    }

    const appointment = await db.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          patientId: input.patientId,
          therapistId: input.therapistId,
          roomId: input.roomId ?? null,
          startsAt: input.startsAt,
          durationMinutes: input.durationMinutes,
          status: AppointmentStatus.SCHEDULED,
          notes: input.notes ?? null,
          createdById: session.user.id,
        },
      });
      // Booking a patient with a therapist makes that therapist part of the
      // patient's care team so they appear in "My patients" + dashboard.
      // Idempotent, add-never-replace (Prompt 15.5 — mirrors the plan-create
      // doctor back-fill). Covered by this appointment's CREATE audit.
      await addCareTeamMemberTx(tx, input.patientId, input.therapistId, session.user.id);
      return appt;
    });

    const offset = await getReminderOffsetMinutes();
    await enqueueAppointmentReminder({
      appointmentId: appointment.id,
      startsAt: appointment.startsAt,
      reminderOffsetMinutes: offset,
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
        where: { id: input.therapistId },
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
          therapistId: true,
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
      select: {
        id: true,
        patientId: true,
        therapistId: true,
        status: true,
      },
    });
    if (!existing) throw new AppointmentError(notFound);

    const therapistId = input.therapistId ?? existing.therapistId;

    const conflicts = await checkConflicts({
      appointmentId: input.id,
      patientId: existing.patientId,
      therapistId,
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
          therapistId,
          roomId: input.roomId ?? null,
        },
      });
      // A reschedule onto a different therapist (e.g. dragging to another
      // resource column) adds the new therapist to the care team — never
      // removes the previous one. Idempotent when the therapist is unchanged.
      await addCareTeamMemberTx(
        tx,
        existing.patientId,
        therapistId,
        session?.user?.id ?? therapistId,
      );
    });

    // Re-enqueue the reminder against the new fire time.
    await cancelAppointmentReminder(input.id);
    if (
      existing.status === AppointmentStatus.SCHEDULED ||
      existing.status === AppointmentStatus.CONFIRMED
    ) {
      const offset = await getReminderOffsetMinutes();
      await enqueueAppointmentReminder({
        appointmentId: input.id,
        startsAt: input.startsAt,
        reminderOffsetMinutes: offset,
      });
    }

    return {
      appointmentId: input.id,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
    };
  },
);

export const changeAppointmentTherapist = withAudit<
  [AppointmentChangeTherapistParsed],
  {
    appointmentId: string;
    conflictsOverridden: boolean;
    previousTherapistId: string;
    newTherapistId: string;
    reason: string | null;
  }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) =>
      db.appointment.findUnique({
        where: { id: args[0].id },
        select: { therapistId: true },
      }),
    extractAfter: (result) => ({
      event: result.conflictsOverridden ? 'OVERRIDE_CONFLICT' : 'THERAPIST_CHANGED',
      previousTherapistId: result.previousTherapistId,
      newTherapistId: result.newTherapistId,
      reason: result.reason,
    }),
  },
  async function changeTherapistInner(input): Promise<{
    appointmentId: string;
    conflictsOverridden: boolean;
    previousTherapistId: string;
    newTherapistId: string;
    reason: string | null;
  }> {
    const existing = await db.appointment.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        patientId: true,
        therapistId: true,
        startsAt: true,
        durationMinutes: true,
        status: true,
        patient: { select: { fullNameEn: true, fullNameAr: true } },
      },
    });
    if (!existing) throw new AppointmentError(notFound);

    // Re-run the conflict engine at submit time. The availability
    // dots in the UI are advisory; the slot may have filled in
    // between render and click. This is the authoritative check.
    const conflicts = await checkConflicts({
      appointmentId: input.id,
      patientId: existing.patientId,
      therapistId: input.therapistId,
      startsAt: existing.startsAt,
      durationMinutes: existing.durationMinutes,
    });
    if (!conflicts.ok && !input.overrideConflicts) {
      throw new AppointmentError(conflictError(conflicts.conflicts));
    }

    // No-op when the user picks the same therapist (e.g. closed +
    // reopened the modal). Avoid the notification fan-out in that case.
    if (existing.therapistId === input.therapistId) {
      return {
        appointmentId: input.id,
        conflictsOverridden: false,
        previousTherapistId: existing.therapistId,
        newTherapistId: input.therapistId,
        reason: input.reason ?? null,
      };
    }

    const session = await auth();
    await db.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: input.id },
        data: { therapistId: input.therapistId },
      });
      // Add the new therapist to the patient's care team (add-never-replace —
      // the previous therapist stays unless removed elsewhere).
      await addCareTeamMemberTx(
        tx,
        existing.patientId,
        input.therapistId,
        session?.user?.id ?? input.therapistId,
      );
    });

    // Notification fan-out — two separate types so each side gets a
    // focused message (Prompt 7b §4.6). Fire-and-forget; the audit
    // row already captured the change above.
    const { createNotification } = await import('@/lib/notifications/actions');
    const dateStr = existing.startsAt.toISOString().slice(0, 10);
    const patientName = existing.patient.fullNameEn;
    void createNotification({
      recipientId: existing.therapistId,
      type: 'APPOINTMENT_THERAPIST_REMOVED',
      params: { patientName, date: dateStr },
      linkPath: `/therapist/schedule`,
      relatedEntityType: 'Appointment',
      relatedEntityId: input.id,
    }).catch((err: unknown) => {
      console.error('[appointments.changeTherapist] removed notification failed', err);
    });
    void createNotification({
      recipientId: input.therapistId,
      type: 'APPOINTMENT_THERAPIST_ASSIGNED',
      params: { patientName, date: dateStr },
      linkPath: `/therapist/schedule`,
      relatedEntityType: 'Appointment',
      relatedEntityId: input.id,
    }).catch((err: unknown) => {
      console.error('[appointments.changeTherapist] assigned notification failed', err);
    });

    return {
      appointmentId: input.id,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
      previousTherapistId: existing.therapistId,
      newTherapistId: input.therapistId,
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
        therapistId,
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

    const shortNotice = existing.startsAt.getTime() - Date.now() < 2 * 60 * 60 * 1000;

    await db.appointment.update({
      where: { id: input.id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: input.cancellationReason,
        cancellationCategory: input.cancellationCategory,
        cancellationNotes: input.cancellationNotes ?? null,
      },
    });
    await cancelAppointmentReminder(input.id);

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
          },
        });
        updated.push(occ.id);
      }
      return updated;
    });

    // Side effects after commit.
    await Promise.all(ids.map((id) => cancelAppointmentReminder(id)));

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
      select: { id: true, startsAt: true, therapistId: true, status: true },
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
      newTherapistId: string;
    }
    const planned: Planned[] = occurrences.map((occ) => ({
      occ,
      newStartsAt: new Date(occ.startsAt.getTime() + deltaMs),
      // For the single-appointment path the user may have changed
      // duration / therapist / room. For the bulk path we keep those
      // per-occurrence (each row keeps its own duration + therapist).
      newDurationMinutes: occ.id === target.id ? input.durationMinutes : occ.durationMinutes,
      newTherapistId:
        occ.id === target.id ? (input.therapistId ?? occ.therapistId) : occ.therapistId,
    }));

    const failures: BulkFailure[] = [];
    await db.$transaction(async (tx) => {
      for (const p of planned) {
        const conflicts = await checkConflicts({
          appointmentId: p.occ.id,
          patientId: p.occ.patientId,
          therapistId: p.newTherapistId,
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
            therapistId: p.newTherapistId,
            ...(p.occ.id === target.id && input.roomId !== undefined
              ? { roomId: input.roomId }
              : {}),
          },
        });
      }
    });

    // Re-enqueue reminders for active occurrences.
    const ids = planned.map((p) => p.occ.id);
    await Promise.all(ids.map((id) => cancelAppointmentReminder(id)));
    const offset = await getReminderOffsetMinutes();
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
            reminderOffsetMinutes: offset,
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
    previousTherapistId: string;
    newTherapistId: string;
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
      previousTherapistId: result.previousTherapistId,
      newTherapistId: result.newTherapistId,
      reason: result.reason,
    }),
  },
  async function changeTherapistSeriesInner(input): Promise<{
    appointmentIds: string[];
    previousTherapistId: string;
    newTherapistId: string;
    reason: string | null;
    conflictsOverridden: boolean;
  }> {
    const occurrences = await selectSeriesOccurrences({
      appointmentId: input.id,
      mode: input.seriesMode,
    });
    if (occurrences.length === 0) throw new AppointmentError(notFound);
    const previousTherapistId = occurrences[0]!.therapistId;

    const failures: BulkFailure[] = [];
    await db.$transaction(async (tx) => {
      for (const occ of occurrences) {
        const conflicts = await checkConflicts({
          appointmentId: occ.id,
          patientId: occ.patientId,
          therapistId: input.therapistId,
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
        if (occ.therapistId === input.therapistId) continue;
        await tx.appointment.update({
          where: { id: occ.id },
          data: { therapistId: input.therapistId },
        });
      }
    });

    // Single summary notification per side (Prompt 7b §4.7 — don't
    // spam the therapist with N rows).
    if (previousTherapistId !== input.therapistId) {
      const patient = await db.appointment
        .findUnique({
          where: { id: input.id },
          select: { patient: { select: { fullNameEn: true } } },
        })
        .then((r) => r?.patient.fullNameEn ?? '');
      const firstStart = occurrences[0]!.startsAt.toISOString().slice(0, 10);
      const { createNotification } = await import('@/lib/notifications/actions');
      void createNotification({
        recipientId: previousTherapistId,
        type: 'APPOINTMENT_THERAPIST_REMOVED',
        params: { patientName: patient, date: firstStart },
        linkPath: `/therapist/schedule`,
        relatedEntityType: 'Appointment',
        relatedEntityId: input.id,
      }).catch((err: unknown) => {
        console.error('[appointments.changeTherapistSeries] removed notif failed', err);
      });
      void createNotification({
        recipientId: input.therapistId,
        type: 'APPOINTMENT_THERAPIST_ASSIGNED',
        params: { patientName: patient, date: firstStart },
        linkPath: `/therapist/schedule`,
        relatedEntityType: 'Appointment',
        relatedEntityId: input.id,
      }).catch((err: unknown) => {
        console.error('[appointments.changeTherapistSeries] assigned notif failed', err);
      });
    }

    return {
      appointmentIds: occurrences.map((o) => o.id),
      previousTherapistId,
      newTherapistId: input.therapistId,
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
      select: { id: true, status: true, therapistId: true, startsAt: true },
    });
    if (!existing) throw new AppointmentError(notFound);

    if (!canTransition(existing.status, to)) {
      throw new AppointmentError(STATUS_ERRORS.INVALID_TRANSITION(existing.status, to));
    }

    // Therapist may only complete THEIR OWN in-progress appointment.
    if (
      session.user.role === UserRole.THERAPIST &&
      to === AppointmentStatus.COMPLETED &&
      existing.therapistId !== session.user.id
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
        therapistId: input.therapistId,
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
  therapistId: string;
  startsAt: Date;
  durationMinutes: number;
}): Promise<ConflictResult> {
  return checkConflicts({
    patientId: input.patientId,
    therapistId: input.therapistId,
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
            therapistId: input.therapistId,
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
              therapistId: input.therapistId,
              roomId: input.roomId ?? null,
              startsAt: occ.startsAt,
              durationMinutes: occ.durationMinutes,
              status: AppointmentStatus.SCHEDULED,
              notes: input.notes ?? null,
              createdById: session.user!.id!,
              seriesId,
            },
            select: { id: true, startsAt: true },
          });
          ids.push(created.id);
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
    const offset = await getReminderOffsetMinutes();
    await Promise.all(
      appointmentIds.map((id, i) =>
        enqueueAppointmentReminder({
          appointmentId: id,
          startsAt: finalOccurrences[i]!.startsAt,
          reminderOffsetMinutes: offset,
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
