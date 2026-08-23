import { AppointmentStatus, AppointmentType, AuditAction, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { addCareTeamMemberTx } from '@/lib/patients/assignment';
import {
  cancelAppointmentReminder,
  enqueueAppointmentReminder,
} from '@/lib/queue/jobs/appointmentReminder';
import { recordDispatchEvent } from '@/lib/whatsapp/dispatch/service';
import { cancelAutoCompleteSession } from '@/lib/queue/jobs/autoCompleteSession';
import { clinicDateKey, clinicHm } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';
import { notifyWaitlistForFreedSlot } from '@/lib/waitlist/services';

import {
  checkConflicts,
  hasHardBlockedConflict,
  type Conflict,
  type ConflictResult,
} from './conflicts';
import { parseHhMm, pickSeriesReminderTargets, type ReminderConfig } from './reminderWindow';
import { getSessionGraceConfig } from './session-settings';
import {
  canStartSessionAt,
  earliestSessionStart,
  isStartInPast,
  sessionStartTooEarly,
} from './session-timing';
import { RESIZE_MIN_MINUTES } from './schemas';
import type {
  AppointmentCancelParsed,
  AppointmentChangeTherapistParsed,
  AppointmentCreateInput,
  AppointmentRescheduleParsed,
  SeriesBatchCreateInput,
} from './schemas';
import { selectSeriesOccurrences } from './series';
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

// QA retest #15 + Prompt 22 §4.1/§4.2 + R-22 ruling (Prompt 42) — hard-blocked
// conflicts can never be overridden. Thrown even when overrideConflicts is
// set. The message names the dominant blocker: same-patient overlap wins over
// the closed-day case when both are present.
const hardBlockedError = async (conflicts: Conflict[]): Promise<LocalizedError> => {
  const details = { conflicts: conflicts as unknown as Record<string, unknown> };
  const patientOverlap = conflicts.find((c) => c.kind === 'PATIENT_OVERLAP');
  if (patientOverlap && patientOverlap.kind === 'PATIENT_OVERLAP') {
    // R-22: the rejection names the existing appointment's clinic-local time
    // («لدى المريض موعد آخر في هذا الوقت ({time})»).
    const clash = patientOverlap.appointment?.startsAt;
    let time = '';
    if (clash) {
      const tz = await getClinicTimeZone();
      time = ` (${clinicDateKey(clash, tz)} ${clinicHm(clash, tz)})`;
    }
    return {
      code: 'APPOINTMENT_SAME_PATIENT_OVERLAP',
      message_en: `This patient already has another appointment at this time${time}. Pick another slot.`,
      message_ar: `لدى هذا المريض موعد آخر في هذا الوقت${time}. الرجاء اختيار وقت آخر.`,
      details,
    };
  }
  // July #8 part 2 — the room is held by an event (maintenance / meeting).
  const blocked = conflicts.find((c) => c.kind === 'ROOM_BLOCKED_BY_EVENT');
  if (blocked && blocked.kind === 'ROOM_BLOCKED_BY_EVENT') {
    return {
      code: 'APPOINTMENT_ROOM_BLOCKED_BY_EVENT',
      message_en: `${blocked.roomName} is held by an event (${blocked.event.title ?? 'event'}) at this time. Pick another room or time.`,
      message_ar: `الغرفة ${blocked.roomName} محجوزة لفعالية (${blocked.event.title ?? 'فعالية'}) في هذا الوقت. اختر غرفة أو وقتًا آخر.`,
      details,
    };
  }
  // July #8 — the stretching room has no free bed in this time window.
  const capacity = conflicts.find((c) => c.kind === 'ROOM_AT_CAPACITY');
  if (capacity && capacity.kind === 'ROOM_AT_CAPACITY') {
    return {
      code: 'APPOINTMENT_ROOM_AT_CAPACITY',
      message_en: `${capacity.roomName} is at bed capacity (${capacity.bedCount}) for this time. Pick another room or time.`,
      message_ar: `الغرفة ${capacity.roomName} ممتلئة بالكامل (${capacity.bedCount} سرير) في هذا الوقت. اختر غرفة أو وقتًا آخر.`,
      details,
    };
  }
  return {
    code: 'APPOINTMENT_ON_CLOSED_DAY',
    message_en:
      'The clinic is closed on this day. Appointments cannot be booked on non-working days.',
    message_ar: 'العيادة مغلقة في هذا اليوم. لا يمكن حجز مواعيد في أيام العطلة.',
    details,
  };
};

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

/** P53 — the two admin-configurable lifecycle delays (minutes, default 0). */
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

/**
 * P50 (series 45+) §3.2–3.3 — re-run the same-day reminder dedup for a
 * series on the given clinic-local days. The earliest live upcoming
 * occurrence of each day is (re-)enqueued (idempotent — the job is replaced,
 * never duplicated); every other live occurrence of that day loses its job.
 * Called after a series occurrence is cancelled or moved so the next
 * sibling INHERITS the day's reminder; when the inherited lead time is
 * already under the offset, computeReminderFireAt applies the P17
 * late-booking rule (send now inside the window / next opening / skip).
 * Best-effort: a queue failure never breaks the calling mutation.
 */
async function resyncSeriesDayReminders(args: {
  seriesId: string;
  instants: Date[];
  config: ReminderConfig;
}): Promise<void> {
  const days = new Set(args.instants.map((d) => clinicDateKey(d, args.config.timeZone)));
  const live = await db.appointment.findMany({
    where: {
      seriesId: args.seriesId,
      status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
      startsAt: { gt: new Date() },
    },
    select: { id: true, startsAt: true },
  });
  const onDays = live.filter((a) => days.has(clinicDateKey(a.startsAt, args.config.timeZone)));
  const targets = pickSeriesReminderTargets(onDays, args.config.timeZone);
  const targetIds = new Set(targets.map((t) => t.id));
  for (const occ of onDays) {
    if (targetIds.has(occ.id)) {
      await enqueueAppointmentReminder({
        appointmentId: occ.id,
        startsAt: occ.startsAt,
        config: args.config,
      }).catch((err: unknown) => {
        console.error('[series.reminders] resync enqueue failed', { id: occ.id, err });
      });
    } else {
      await cancelAppointmentReminder(occ.id);
    }
  }
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

    // GROUP therapy / workshops (July #8 part 3): patients live in the
    // AppointmentPatient M2M, not the scalar patientId. R-22 (Prompt 42):
    // every member runs the same-patient overlap check via `patientIds`.
    const isGroup = input.appointmentType === AppointmentType.GROUP;
    const groupPatientIds = isGroup ? [...new Set(input.patientIds)] : [];

    const conflicts = await checkConflicts({
      patientId: input.patientId,
      patientIds: groupPatientIds,
      therapistIds: input.therapistIds,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      appointmentType: input.appointmentType,
      roomId: input.roomId,
    });

    if (!conflicts.ok) {
      // Same-patient overlap is never overridable (QA retest #15) — reject even
      // when the actor passed overrideConflicts + holds the override permission.
      if (hasHardBlockedConflict(conflicts.conflicts)) {
        throw new AppointmentError(await hardBlockedError(conflicts.conflicts));
      }
      if (!input.overrideConflicts) {
        throw new AppointmentError(conflictError(conflicts.conflicts));
      }
    }

    const therapistIds = [...new Set(input.therapistIds)];
    // Non-GROUP types keep the single scalar patient (choice B — Hybrid). One
    // list drives the care-team loop + per-patient reminder seam regardless
    // of mechanism.
    const carePatientIds = isGroup ? groupPatientIds : input.patientId ? [input.patientId] : [];
    const appointment = await db.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          patientId: isGroup ? null : (input.patientId ?? null),
          appointmentType: input.appointmentType,
          title: input.title ?? null,
          roomId: input.roomId ?? null,
          startsAt: input.startsAt,
          durationMinutes: input.durationMinutes,
          status: AppointmentStatus.SCHEDULED,
          notes: input.notes ?? null,
          createdById: session.user.id,
          therapists: { create: therapistIds.map((therapistId) => ({ therapistId })) },
          groupPatients: isGroup
            ? { create: groupPatientIds.map((patientId) => ({ patientId })) }
            : undefined,
        },
      });
      // Booking a patient with therapists makes EACH of them part of that
      // patient's care team so they appear in "My patients" + dashboard. A
      // GROUP fans this out across every member × every therapist; a
      // patient-less EVENT has no care team to touch (July #8).
      for (const patientId of carePatientIds) {
        for (const therapistId of therapistIds) {
          await addCareTeamMemberTx(tx, patientId, therapistId, session.user.id);
        }
      }
      return appt;
    });

    // A patient-less EVENT gets no reminder (no one to remind) and no
    // confirmation message. It still auto-completes at its scheduled end. A
    // GROUP enqueues one reminder job; the worker fans it out per member (#6).
    if (carePatientIds.length > 0) {
      const config = await getReminderConfig();
      await enqueueAppointmentReminder({
        appointmentId: appointment.id,
        startsAt: appointment.startsAt,
        config,
      });
    }

    // P48 — the booking confirmation goes through the dispatch funnel:
    // AUTO (the P53 deferred job with the admin delay) or MANUAL (admin
    // outbox — never sends on its own; the <24h exception is gone).
    // GROUP/EVENT (no patientId) keep today's behavior: no confirmation.
    if (input.patientId) {
      await recordDispatchEvent({
        appointmentId: appointment.id,
        patientId: input.patientId,
        startsAt: appointment.startsAt,
        type: 'BOOKING_CONFIRMATION',
      }).catch((err: unknown) => {
        console.error('[appointments.create] dispatch record failed', err);
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
  { appointmentId: string; conflictsOverridden: boolean; resized: boolean }
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
      event: result.resized
        ? 'APPOINTMENT_RESIZED'
        : result.conflictsOverridden
          ? 'OVERRIDE_CONFLICT'
          : 'APPOINTMENT_RESCHEDULED',
    }),
  },
  async function rescheduleInner(
    input: AppointmentRescheduleParsed,
  ): Promise<{ appointmentId: string; conflictsOverridden: boolean; resized: boolean }> {
    const session = await auth();
    const existing = await db.appointment.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        patientId: true,
        status: true,
        appointmentType: true,
        roomId: true,
        // P50 — a series occurrence re-runs the same-day reminder dedup
        // for its old + new day instead of blindly re-enqueueing itself.
        seriesId: true,
        // Prompt 48: the reschedule message fires only on an ACTUAL start
        // change — compare against the stored start (owner ruling: resizes
        // and same-slot saves stay silent).
        startsAt: true,
        // GROUP members — dragging a group re-checks every member's schedule
        // at the new time (R-22, Prompt 42).
        groupPatients: { select: { patientId: true } },
      },
    });
    if (!existing) throw new AppointmentError(notFound);

    // A resize keeps the start time, so the "start in the past" guard doesn't
    // apply (nothing is moving into the past). A real reschedule still blocks.
    if (!input.resize && isStartInPast(input.startsAt)) throw new AppointmentError(inPast);

    // Omitted therapistIds → keep the existing set (pure time/room move, e.g.
    // dragging a multi-therapist session). Provided → replace it (e.g. dragging
    // a single-therapist appointment into another therapist's lane).
    const existingTherapistIds = await getAppointmentTherapistIds(input.id);
    const therapistIds = input.therapistIds ?? existingTherapistIds;

    // Duration-only resize (July #6): clamp to the calendar grid floor so a
    // drag never creates a zero/negative-length appointment.
    const durationMinutes = input.resize
      ? Math.max(RESIZE_MIN_MINUTES, input.durationMinutes)
      : input.durationMinutes;

    let conflictsOverridden = false;
    const conflicts = await checkConflicts({
      appointmentId: input.id,
      patientId: existing.patientId,
      patientIds: existing.groupPatients.map((g) => g.patientId),
      therapistIds,
      startsAt: input.startsAt,
      durationMinutes,
      // A drag of a STRETCHING appointment re-runs the bed-capacity check
      // at the new time (July #8). roomId omitted on a drag → keep existing.
      appointmentType: existing.appointmentType,
      roomId: input.roomId ?? existing.roomId,
    });
    // A resize is treated exactly like a drag (PT-B2 §5.2, owner ruling —
    // "free resize" is withdrawn): the same engine, the same messages, the
    // same override permission. Dragging the bottom edge moves the end of the
    // appointment, which double-books a therapist or a room just as surely as
    // moving the whole block does.
    if (!conflicts.ok) {
      // Hard-blocked kinds (same-patient overlap, closed day, bed capacity)
      // reject even with overrideConflicts + the permission (Prompt 22 §4.1).
      if (hasHardBlockedConflict(conflicts.conflicts)) {
        throw new AppointmentError(await hardBlockedError(conflicts.conflicts));
      }
      if (!input.overrideConflicts) {
        throw new AppointmentError(conflictError(conflicts.conflicts));
      }
      conflictsOverridden = true;
    }

    await db.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: input.id },
        // A resize touches ONLY the duration — start time and room are left
        // exactly as they were. A reschedule moves start (+ room only when the
        // caller sends one): the calendar drag omits roomId entirely, and the
        // old `?? null` here silently STRIPPED the room from every dragged
        // appointment (Prompt 34 — found while verifying NI-3; the series
        // variant already had the undefined-means-keep guard).
        data: input.resize
          ? { durationMinutes }
          : {
              startsAt: input.startsAt,
              durationMinutes,
              ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
            },
      });
      if (input.therapistIds) {
        await setAppointmentTherapistsTx(tx, input.id, therapistIds);
      }
      // Adding a therapist (e.g. dragging to another resource column) adds them
      // to the care team — add-never-replace, idempotent when unchanged. A
      // patient-less EVENT has no care team (July #8).
      if (existing.patientId) {
        const patientId = existing.patientId;
        for (const therapistId of therapistIds) {
          await addCareTeamMemberTx(tx, patientId, therapistId, session?.user?.id ?? therapistId);
        }
      }
    });

    // Re-enqueue the reminder + auto-complete against the new fire time.
    await cancelAppointmentReminder(input.id);
    await cancelAutoCompleteSession(input.id);
    if (
      existing.status === AppointmentStatus.SCHEDULED ||
      existing.status === AppointmentStatus.CONFIRMED
    ) {
      const config = await getReminderConfig();
      if (existing.seriesId) {
        // P50 §3.2: same-day dedup holds across moves — the old day may
        // need a new earliest, the new day may already have one.
        await resyncSeriesDayReminders({
          seriesId: existing.seriesId,
          instants: [existing.startsAt, input.startsAt],
          config,
        });
      } else {
        await enqueueAppointmentReminder({
          appointmentId: input.id,
          startsAt: input.startsAt,
          config,
        });
      }
    }

    // Prompt 48 — the reschedule message. Fires ONLY when the start actually
    // moved (owner ruling: duration-only resizes and same-slot saves are
    // silent). One shared funnel; identical from drag, calendar modal, and
    // patient-file modal. Best-effort — a WhatsApp outage never breaks the
    // reschedule.
    const startChanged = !input.resize && existing.startsAt.getTime() !== input.startsAt.getTime();
    if (startChanged) {
      // P48 dispatch funnel. The funnel itself applies the P53 §1.3 rule:
      // a reschedule before the confirmation ever left is re-issued as a
      // fresh CONFIRMATION with the new details.
      await recordDispatchEvent({
        appointmentId: input.id,
        patientId: existing.patientId,
        startsAt: input.startsAt,
        type: 'RESCHEDULE',
      }).catch((err: unknown) => {
        console.error('[appointments.reschedule] dispatch record failed', err);
      });
    }

    return {
      appointmentId: input.id,
      conflictsOverridden,
      resized: input.resize,
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
    if (!conflicts.ok) {
      // Hard-blocked kinds reject even with overrideConflicts (Prompt 22 §4.1).
      if (hasHardBlockedConflict(conflicts.conflicts)) {
        throw new AppointmentError(await hardBlockedError(conflicts.conflicts));
      }
      if (!input.overrideConflicts) {
        throw new AppointmentError(conflictError(conflicts.conflicts));
      }
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
      if (existing.patientId) {
        const patientId = existing.patientId;
        for (const therapistId of added) {
          await addCareTeamMemberTx(tx, patientId, therapistId, session?.user?.id ?? therapistId);
        }
      }
    });

    // Notify each added + removed therapist (Prompt 7b §4.6, extended to the
    // set in Prompt 20). Fire-and-forget; the audit row already captured it.
    const { createNotification } = await import('@/lib/notifications/actions');
    const dateStr = clinicDateKey(existing.startsAt, await getClinicTimeZone());
    const patientName = existing.patient?.fullNameEn ?? '';
    for (const therapistId of removed) {
      void createNotification({
        recipientId: therapistId,
        type: 'APPOINTMENT_THERAPIST_REMOVED',
        params: { patientName, date: dateStr },
        linkPath: `/therapist/calendar`,
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
        linkPath: `/therapist/calendar`,
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
  conflictKinds: Array<Conflict['kind']>;
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
        seriesId: true,
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
    await cancelAutoCompleteSession(input.id);
    // P50 §3.3: if this was the reminded occurrence of a same-day pair, the
    // next sibling of that clinic-local day inherits the reminder.
    if (existing.seriesId) {
      await resyncSeriesDayReminders({
        seriesId: existing.seriesId,
        instants: [existing.startsAt],
        config: await getReminderConfig(),
      });
    }
    // P48 dispatch funnel: supersedes any pending confirmation/reschedule
    // (last-state-wins), applies the silent booking+cancel close, and
    // honors the per-type mode/delay (MANUAL parks — never sends; the <24h
    // exception is gone, owner order 19 Aug). The notifyPatient=false path
    // still supersedes but sends nothing.
    const dispatch = await recordDispatchEvent({
      appointmentId: input.id,
      patientId: existing.patientId,
      startsAt: existing.startsAt,
      type: 'CANCELLATION',
      notify: Boolean(
        input.notifyPatient && existing.patient?.whatsappReachable && existing.patient.phone,
      ),
    }).catch((err: unknown) => {
      console.error('[appointments.cancel] dispatch record failed', err);
      return { entryId: null, suppressed: null, confirmWasPending: false };
    });
    const confirmWasPending = dispatch.confirmWasPending;
    // §1-Item2.3: if the SERIES confirmation was pending on THIS occurrence,
    // retarget it to the next nearest upcoming occurrence (timer restarts;
    // removed entirely when none remain).
    if (confirmWasPending && existing.seriesId) {
      const next = await db.appointment.findFirst({
        where: {
          seriesId: existing.seriesId,
          id: { not: input.id },
          status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
          startsAt: { gte: new Date() },
        },
        orderBy: { startsAt: 'asc' },
        select: { id: true, startsAt: true },
      });
      if (next) {
        // Through the funnel so MANUAL mode parks the retargeted
        // confirmation in the outbox exactly like a fresh booking.
        await recordDispatchEvent({
          appointmentId: next.id,
          patientId: existing.patientId,
          startsAt: next.startsAt,
          type: 'BOOKING_CONFIRMATION',
        }).catch((err: unknown) => {
          console.error('[appointments.cancel] series confirmation retarget failed', err);
        });
      }
    }

    // Prompt 19 — the slot just freed; suggest it to anyone on the booking
    // waitlist whose window covers it. A multi-therapist session frees the slot
    // for EACH assigned therapist (Prompt 20). Best-effort: never blocks cancel.
    for (const { therapistId } of existing.therapists) {
      await notifyWaitlistForFreedSlot({ startsAt: existing.startsAt, therapistId });
    }

    // The cancellation message itself is handled by the dispatch funnel
    // above (sendCancelled re-reads the row at fire time).

    return { appointmentId: input.id, flaggedShortNotice: shortNotice };
  },
);

// ─── Series bulk path — CANCEL ONLY (Prompt 7b §4.7, narrowed by Prompt 45
//     rows 1+2: edits never fan out; cancelling a whole series remains a
//     clinic workflow) ────────────────────────────────────────────────────

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
    await Promise.all(ids.map((id) => cancelAutoCompleteSession(id)));
    // P48: supersede every open dispatch entry + queued lifecycle job for
    // the cancelled occurrences (last-state-wins across the whole batch);
    // remember whether ANY unsent series confirmation was pending — the
    // silent-close rule below hangs on it.
    let seriesConfirmWasPending = false;
    for (const id of ids) {
      const r = await recordDispatchEvent({
        appointmentId: id,
        patientId: null,
        startsAt: new Date(0),
        type: 'CANCELLATION',
        notify: false, // supersede-only; the ONE batch message is created below
      }).catch(() => ({ entryId: null, suppressed: null, confirmWasPending: false }));
      seriesConfirmWasPending = seriesConfirmWasPending || r.confirmWasPending;
    }

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
      // P53 (owner-signed): cancelling a whole series sends ONE cancellation
      // — about the nearest occurrence that was coming up. P48 routes it
      // through the dispatch funnel (mode/delay/outbox/safety), with the
      // series-wide silent-close rule: if the series' single confirmation
      // never left AND no confirmation was ever sent for any occurrence,
      // the patient never knew — nothing is sent.
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
        orderBy: { startsAt: 'asc' },
      });
      const now = Date.now();
      const nearest =
        enriched.find(
          (r) => r.startsAt.getTime() >= now && r.patient?.whatsappReachable && r.patient.phone,
        ) ?? enriched.find((r) => r.patient?.whatsappReachable && r.patient.phone);
      if (nearest?.patient?.phone) {
        // Was a confirmation ever SENT for ANY occurrence of this series?
        const { confirmationAlreadySent } =
          await import('@/lib/whatsapp/templates/sendConfirmation');
        let anyConfirmationSent = false;
        for (const id of ids) {
          if (await confirmationAlreadySent(id)) {
            anyConfirmationSent = true;
            break;
          }
        }
        if (seriesConfirmWasPending && !anyConfirmationSent) {
          console.warn(
            `[dispatch] series ${input.id}: cancelled before its confirmation left — nothing sent (silent close)`,
          );
        } else {
          await recordDispatchEvent({
            appointmentId: nearest.id,
            patientId: nearest.patientId,
            startsAt: nearest.startsAt,
            type: 'CANCELLATION',
            confirmationSent: anyConfirmationSent,
          }).catch((err: unknown) => {
            console.error('[appointments.cancelSeries] dispatch record failed', err);
          });
        }
      }
    }

    return { appointmentIds: ids, skippedCount: 0, flaggedShortNotice };
  },
);

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
    // Drop the pending auto-complete once the session reaches a terminal state
    // (manual complete via the arrivals fallback, cancel, or no-show). On
    // IN_PROGRESS we KEEP it — that job is exactly what completes the session
    // at its scheduled end (July #4).
    if (
      to === AppointmentStatus.COMPLETED ||
      to === AppointmentStatus.CANCELLED ||
      to === AppointmentStatus.NO_SHOW
    ) {
      await cancelAutoCompleteSession(id);
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

// ─── Multi-appointment batch booking (July 31 item 4 — replaces the
//     Prompt 7b weekly-pattern series) ────────────────────────────────────

export interface BatchRowPreview {
  rowIndex: number;
  conflicts: ConflictResult;
}

/**
 * Run the conflict engine against every explicit row. Pure-read; no
 * transactions, no audit — the batch modal calls this on submit so ALL
 * conflicting rows light up at once (FR-APP-8 replacement: the skip/shift
 * resolution picker is gone — the secretary fixes or removes the row).
 * Unlike the old pattern preview, the room rides along, so room
 * capacity / event-block conflicts are caught per row too.
 */
export async function previewSeriesBatch(
  input: SeriesBatchCreateInput,
): Promise<{ rows: BatchRowPreview[] }> {
  const rows = await Promise.all(
    input.rows.map(async (row, rowIndex) => ({
      rowIndex,
      conflicts: await checkConflicts({
        patientId: input.patientId,
        therapistIds: row.therapistIds,
        startsAt: row.startsAt,
        durationMinutes: row.durationMinutes,
        appointmentType: AppointmentType.SESSION,
        roomId: row.roomId,
      }),
    })),
  );
  return { rows };
}

export const createSeriesBatch = withAudit<
  [SeriesBatchCreateInput],
  { seriesId: string; appointmentIds: string[] }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.seriesId,
    extractAfter: (result) => ({
      event: 'APPOINTMENT_SERIES_CREATED',
      seriesId: result.seriesId,
      appointmentCount: result.appointmentIds.length,
    }),
  },
  async function createSeriesBatchInner(
    input: SeriesBatchCreateInput,
  ): Promise<{ seriesId: string; appointmentIds: string[] }> {
    const session = await auth();
    if (!session?.user?.id) throw new AppointmentError(unauthenticated);

    // Every row is an explicit concrete slot — reject any past start up
    // front, naming the row (Fix 6C item 1 applied per row).
    for (let i = 0; i < input.rows.length; i++) {
      if (isStartInPast(input.rows[i]!.startsAt)) {
        throw new AppointmentError({
          code: 'SERIES_ROW_IN_PAST',
          message_en: `Row ${i + 1} starts in the past. Pick a current or future time.`,
          message_ar: `الصف رقم ${i + 1} يبدأ في وقت مضى. اختر وقتاً حالياً أو مستقبلياً.`,
          details: { rowIndex: i },
        });
      }
    }

    // Batch-internal duplicates/overlaps are the schema's job (superRefine);
    // conflicts vs. EXISTING data are the engine's job below — including
    // closed days (CLINIC_CLOSED_THIS_DAY, hard-blocked, settings-driven),
    // so a crafted holiday date can't get past the disabled picker.
    const seriesId = `ser_${session.user.id}_${Date.now().toString(36)}`;
    let appointmentIds: string[];
    try {
      appointmentIds = await db.$transaction(async (tx) => {
        const ids: string[] = [];
        for (let i = 0; i < input.rows.length; i++) {
          const row = input.rows[i]!;
          const conflicts = await checkConflicts({
            patientId: input.patientId,
            therapistIds: row.therapistIds,
            startsAt: row.startsAt,
            durationMinutes: row.durationMinutes,
            appointmentType: AppointmentType.SESSION,
            roomId: row.roomId,
          });
          if (!conflicts.ok) {
            // No override path in the batch (FR-APP-8 replacement): ANY
            // conflicting row aborts the whole batch atomically — nothing
            // is half-created. The failing row + its conflicts ride in the
            // details so the modal highlights exactly that row.
            throw new AppointmentError({
              code: 'SERIES_ROW_CONFLICT',
              message_en: `Row ${i + 1} conflicts — fix or remove it before saving.`,
              message_ar: `الصف رقم ${i + 1} يتعارض — عدّله أو احذفه قبل الحفظ.`,
              details: {
                rowIndex: i,
                startsAt: row.startsAt.toISOString(),
                conflicts: conflicts.conflicts as unknown as Record<string, unknown>,
              },
            });
          }
          const created = await tx.appointment.create({
            data: {
              patientId: input.patientId,
              roomId: row.roomId,
              startsAt: row.startsAt,
              durationMinutes: row.durationMinutes,
              status: AppointmentStatus.SCHEDULED,
              notes: input.notes ?? null,
              createdById: session.user!.id!,
              seriesId,
              therapists: {
                create: [...new Set(row.therapistIds)].map((therapistId) => ({ therapistId })),
              },
            },
            select: { id: true },
          });
          ids.push(created.id);
        }
        // Booking adds every therapist appearing in ANY row to the patient's
        // care team (deduped across rows) — same rule as a single booking.
        const allTherapists = new Set(input.rows.flatMap((r) => r.therapistIds));
        for (const therapistId of allTherapists) {
          await addCareTeamMemberTx(tx, input.patientId, therapistId, session.user!.id!);
        }
        return ids;
      });
    } catch (err) {
      // Re-throw AppointmentError untouched; wrap unexpected DB errors so
      // the caller gets a localized message either way. Either way the
      // transaction rolled back — no partial batch survives.
      if (err instanceof AppointmentError) throw err;
      throw new AppointmentError({
        code: 'SERIES_TRANSACTION_FAILED',
        message_en: 'Batch creation failed — no appointments were saved.',
        message_ar: 'فشل إنشاء المواعيد — لم يتم حفظ أي موعد.',
        details: { cause: String((err as Error)?.message ?? err) },
      });
    }

    // Enqueue reminders best-effort after the transaction commits. If the
    // reminder queue is down the appointments are still booked.
    // P50 (series 45+) §3: every clinic-local DAY of the series gets its own
    // 24h reminder (multi-day = one per day), but several occurrences on
    // the SAME day share ONE reminder — the earliest of that day (owner
    // decision: no reminder spam for back-to-back / same-day repeats).
    const config = await getReminderConfig();
    const reminderTargets = pickSeriesReminderTargets(
      appointmentIds.map((id, i) => ({ id, startsAt: input.rows[i]!.startsAt })),
      config.timeZone,
    );
    if (reminderTargets.length < appointmentIds.length) {
      console.warn(
        `[series.create] same-day reminder dedup: ${appointmentIds.length - reminderTargets.length} of ${appointmentIds.length} occurrences share an earlier sibling's reminder`,
      );
    }
    await Promise.all(
      reminderTargets.map(({ id, startsAt }) =>
        enqueueAppointmentReminder({ appointmentId: id, startsAt, config }).catch(
          (err: unknown) => {
            console.error('[series.create] reminder enqueue failed', { id, err });
          },
        ),
      ),
    );

    // Amendment 46.1 — WhatsApp POLICY for a batch (owner decision, verbatim):
    // confirm FIRST only, remind ALL. Exactly ONE booking confirmation is
    // sent — for the EARLIEST row — through the same deferred lifecycle
    // scheduler a single booking uses (same template/variables/queue/logging;
    // the admin-configurable P53 coalescing delay applies identically).
    // Every OTHER row deliberately sends NO confirmation — this is the
    // policy, not an accident of control flow (same day or not, AUTO or
    // MANUAL: one send / one outbox row). Per-day reminders (P50 dedup
    // above) + auto-complete are untouched. Rows are all future (past rejected
    // up front), so "earliest" needs no now-guard; a scheduling failure must
    // never fail or roll back the already-committed batch.
    let earliestIdx = 0;
    for (let i = 1; i < input.rows.length; i += 1) {
      if (input.rows[i]!.startsAt.getTime() < input.rows[earliestIdx]!.startsAt.getTime()) {
        earliestIdx = i;
      }
    }
    await recordDispatchEvent({
      appointmentId: appointmentIds[earliestIdx]!,
      patientId: input.patientId,
      startsAt: input.rows[earliestIdx]!.startsAt,
      type: 'BOOKING_CONFIRMATION',
    }).catch((err: unknown) => {
      console.error('[series.create] dispatch record failed', err);
    });

    return { seriesId, appointmentIds };
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
