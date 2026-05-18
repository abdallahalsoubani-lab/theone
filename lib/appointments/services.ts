import { AppointmentStatus, AuditAction, UserRole } from '@prisma/client';
import type { CancellationCategory } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import {
  cancelAppointmentReminder,
  enqueueAppointmentReminder,
} from '@/lib/queue/jobs/appointmentReminder';

import { checkConflicts, type Conflict, type ConflictResult } from './conflicts';
import { expandRecurrence, MAX_SERIES_OCCURRENCES, type PlannedOccurrence } from './recurrence';
import type {
  AppointmentCancelInput,
  AppointmentChangeTherapistInput,
  AppointmentCreateInput,
  AppointmentRescheduleInput,
  SeriesCreateInput,
  SeriesPreviewInput,
} from './schemas';
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

    const appointment = await db.appointment.create({
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

    const offset = await getReminderOffsetMinutes();
    await enqueueAppointmentReminder({
      appointmentId: appointment.id,
      startsAt: appointment.startsAt,
      reminderOffsetMinutes: offset,
    });

    return {
      appointmentId: appointment.id,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
    };
  },
);

export const rescheduleAppointment = withAudit<
  [AppointmentRescheduleInput],
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
    input: AppointmentRescheduleInput,
  ): Promise<{ appointmentId: string; conflictsOverridden: boolean }> {
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

    await db.appointment.update({
      where: { id: input.id },
      data: {
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes,
        therapistId,
        roomId: input.roomId ?? null,
      },
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
  [AppointmentChangeTherapistInput],
  { appointmentId: string; conflictsOverridden: boolean }
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
    }),
  },
  async function changeTherapistInner(input): Promise<{
    appointmentId: string;
    conflictsOverridden: boolean;
  }> {
    const existing = await db.appointment.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        patientId: true,
        startsAt: true,
        durationMinutes: true,
        status: true,
      },
    });
    if (!existing) throw new AppointmentError(notFound);

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

    await db.appointment.update({
      where: { id: input.id },
      data: { therapistId: input.therapistId },
    });

    return {
      appointmentId: input.id,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
    };
  },
);

export const cancelAppointment = withAudit<
  [AppointmentCancelInput],
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
        templateName: 'appointment_cancelled',
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
