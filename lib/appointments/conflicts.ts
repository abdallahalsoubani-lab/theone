import { AppointmentStatus, type LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';

import { DAY_KEYS, type DayKey } from './conflicts-time';

/**
 * Conflict detection engine — the SINGLE source of truth for whether a
 * proposed appointment slot is valid (Prompt 7 §4.3, extended for multiple
 * therapists per session in Prompt 20).
 *
 * Every server action that creates or moves an appointment routes through
 * `checkConflicts`. Do not scatter conflict logic across pages.
 *
 * A session may have several therapists; the slot is invalid if it clashes for
 * ANY of them. THERAPIST_OVERLAP / THERAPIST_ON_LEAVE conflicts therefore name
 * the specific therapist who is busy so the UI can say who.
 *
 * Pure read; safe to call concurrently from the live-preview endpoint.
 */

export interface ConflictCheckInput {
  /** When updating an existing appointment, exclude it from overlap calc. */
  appointmentId?: string;
  patientId: string;
  /** One or more therapists assigned to the session (min 1). */
  therapistIds: string[];
  /** UTC start. Timezone display is the locale layer's concern. */
  startsAt: Date;
  durationMinutes: number;
}

export interface PersonName {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

export interface AppointmentSummary {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  patient: { id: string; fullNameEn: string; fullNameAr: string };
  /** Therapists on the clashing appointment (for PATIENT_OVERLAP display). */
  therapists: PersonName[];
}

export interface LeaveSummary {
  id: string;
  userId: string;
  startDate: Date;
  endDate: Date;
}

export type Conflict =
  | { kind: 'THERAPIST_OVERLAP'; therapist: PersonName; appointment: AppointmentSummary }
  | { kind: 'PATIENT_OVERLAP'; appointment: AppointmentSummary }
  | { kind: 'THERAPIST_ON_LEAVE'; therapist: PersonName; leave: LeaveSummary }
  | { kind: 'OUTSIDE_BUSINESS_HOURS'; openTime: string; closeTime: string; dayKey: DayKey }
  | { kind: 'CLINIC_CLOSED_THIS_DAY'; dayKey: DayKey };

export type ConflictResult = { ok: true } | { ok: false; conflicts: Conflict[] };

interface DayHours {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
  closed: boolean;
}

interface ClinicHoursPayload {
  hours: Record<DayKey, DayHours> | null;
}

// Statuses considered "active" — terminal statuses (COMPLETED / CANCELLED /
// NO_SHOW) never collide with new bookings.
const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
];

export async function checkConflicts(
  input: ConflictCheckInput,
  options: { hours?: ClinicHoursPayload } = {},
): Promise<ConflictResult> {
  const conflicts: Conflict[] = [];
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
  const therapistIds = [...new Set(input.therapistIds)];

  // Names for the assigned therapists, so overlap/leave conflicts can say who.
  const people = await db.user.findMany({
    where: { id: { in: therapistIds } },
    select: { id: true, fullNameEn: true, fullNameAr: true },
  });
  const personById = new Map<string, PersonName>(people.map((p) => [p.id, p]));
  const personFor = (id: string): PersonName =>
    personById.get(id) ?? { id, fullNameEn: id, fullNameAr: id };

  // ── 1. Therapist overlap (per assigned therapist) ─────────────────────
  for (const therapistId of therapistIds) {
    const overlaps = await findOverlappingAppointments({
      scope: { therapistId },
      startsAt: input.startsAt,
      endsAt,
      excludeId: input.appointmentId,
    });
    for (const a of overlaps) {
      conflicts.push({
        kind: 'THERAPIST_OVERLAP',
        therapist: personFor(therapistId),
        appointment: a,
      });
    }
  }

  // ── 2. Patient overlap ────────────────────────────────────────────────
  const patientOverlaps = await findOverlappingAppointments({
    scope: { patientId: input.patientId },
    startsAt: input.startsAt,
    endsAt,
    excludeId: input.appointmentId,
  });
  for (const a of patientOverlaps) {
    conflicts.push({ kind: 'PATIENT_OVERLAP', appointment: a });
  }

  // ── 3. Therapist(s) on approved leave ─────────────────────────────────
  const leaveStart = startOfUtcDay(input.startsAt);
  const leaveEnd = startOfUtcDay(endsAt);
  const leaves = await db.leave.findMany({
    where: {
      userId: { in: therapistIds },
      status: 'APPROVED',
      startDate: { lte: leaveEnd },
      endDate: { gte: leaveStart },
    },
    select: { id: true, userId: true, startDate: true, endDate: true },
  });
  for (const leave of leaves) {
    conflicts.push({ kind: 'THERAPIST_ON_LEAVE', therapist: personFor(leave.userId), leave });
  }

  // ── 4. Business hours ─────────────────────────────────────────────────
  const hours = options.hours ?? (await loadClinicHours());
  if (hours.hours) {
    const dayKey = DAY_KEYS[input.startsAt.getUTCDay()] as DayKey;
    const day = hours.hours[dayKey];
    if (day) {
      if (day.closed) {
        conflicts.push({ kind: 'CLINIC_CLOSED_THIS_DAY', dayKey });
      } else {
        const startHm = toHm(input.startsAt);
        const endHm = toHm(endsAt);
        if (startHm < day.open || endHm > day.close) {
          conflicts.push({
            kind: 'OUTSIDE_BUSINESS_HOURS',
            openTime: day.open,
            closeTime: day.close,
            dayKey,
          });
        }
      }
    }
  }

  return conflicts.length === 0 ? { ok: true } : { ok: false, conflicts };
}

async function findOverlappingAppointments(args: {
  scope: { therapistId: string } | { patientId: string };
  startsAt: Date;
  endsAt: Date;
  excludeId?: string;
}): Promise<AppointmentSummary[]> {
  // Two appointments overlap iff: a.startsAt < b.endsAt AND a.endsAt > b.startsAt.
  // Prisma can't express "computed endsAt" in a where clause without a raw
  // query, so we use a generous window (startsAt within +/- 12h of target)
  // and apply the precise overlap filter in JS.
  const windowStart = new Date(args.startsAt.getTime() - 12 * 60 * 60 * 1000);
  const windowEnd = new Date(args.endsAt.getTime() + 12 * 60 * 60 * 1000);

  const scopeWhere =
    'therapistId' in args.scope
      ? { therapists: { some: { therapistId: args.scope.therapistId } } }
      : { patientId: args.scope.patientId };

  const candidates = await db.appointment.findMany({
    where: {
      ...scopeWhere,
      status: { in: ACTIVE_STATUSES },
      startsAt: { gte: windowStart, lte: windowEnd },
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
    },
    include: {
      patient: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      therapists: {
        include: { therapist: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      },
    },
  });

  const ts = args.startsAt.getTime();
  const te = args.endsAt.getTime();
  return candidates
    .filter((c) => {
      const cs = c.startsAt.getTime();
      const ce = cs + c.durationMinutes * 60_000;
      return cs < te && ce > ts;
    })
    .map((c) => ({
      id: c.id,
      startsAt: c.startsAt,
      durationMinutes: c.durationMinutes,
      status: c.status,
      patient: c.patient,
      therapists: c.therapists.map((t) => t.therapist),
    }));
}

async function loadClinicHours(): Promise<ClinicHoursPayload> {
  const row = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { businessHours: true },
  });
  return { hours: (row?.businessHours as unknown as Record<DayKey, DayHours> | null) ?? null };
}

function startOfUtcDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function toHm(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export type { DayHours };
export { DAY_KEYS, type DayKey };
export type LocalizedConflictLabel = (c: Conflict, language: LanguagePref) => string;
