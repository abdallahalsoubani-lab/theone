import { AppointmentStatus, type LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';

import { DAY_KEYS, type DayKey } from './conflicts-time';

/**
 * Conflict detection engine — the SINGLE source of truth for whether a
 * proposed appointment slot is valid (Prompt 7 §4.3).
 *
 * Every server action that creates or moves an appointment routes through
 * `checkConflicts`. Do not scatter conflict logic across pages.
 *
 * Pure read; safe to call concurrently from the live-preview endpoint.
 */

export interface ConflictCheckInput {
  /** When updating an existing appointment, exclude it from overlap calc. */
  appointmentId?: string;
  patientId: string;
  therapistId: string;
  /** UTC start. Timezone display is the locale layer's concern. */
  startsAt: Date;
  durationMinutes: number;
}

export interface AppointmentSummary {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  patient: { id: string; fullNameEn: string; fullNameAr: string };
  therapist: { id: string; fullNameEn: string; fullNameAr: string };
}

export interface LeaveSummary {
  id: string;
  userId: string;
  startDate: Date;
  endDate: Date;
}

export type Conflict =
  | { kind: 'THERAPIST_OVERLAP'; appointment: AppointmentSummary }
  | { kind: 'PATIENT_OVERLAP'; appointment: AppointmentSummary }
  | { kind: 'THERAPIST_ON_LEAVE'; leave: LeaveSummary }
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
// NO_SHOW) never collide with new bookings. This matches the partial index
// in the appointment_indexes migration.
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

  // ── 1. Therapist overlap ──────────────────────────────────────────────
  const therapistOverlaps = await findOverlappingAppointments({
    field: 'therapistId',
    id: input.therapistId,
    startsAt: input.startsAt,
    endsAt,
    excludeId: input.appointmentId,
  });
  for (const a of therapistOverlaps) {
    conflicts.push({ kind: 'THERAPIST_OVERLAP', appointment: a });
  }

  // ── 2. Patient overlap ────────────────────────────────────────────────
  const patientOverlaps = await findOverlappingAppointments({
    field: 'patientId',
    id: input.patientId,
    startsAt: input.startsAt,
    endsAt,
    excludeId: input.appointmentId,
  });
  for (const a of patientOverlaps) {
    conflicts.push({ kind: 'PATIENT_OVERLAP', appointment: a });
  }

  // ── 3. Therapist on approved leave ────────────────────────────────────
  const leaveStart = startOfUtcDay(input.startsAt);
  const leaveEnd = startOfUtcDay(endsAt);
  const leaves = await db.leave.findMany({
    where: {
      userId: input.therapistId,
      status: 'APPROVED',
      startDate: { lte: leaveEnd },
      endDate: { gte: leaveStart },
    },
    select: { id: true, userId: true, startDate: true, endDate: true },
  });
  for (const leave of leaves) {
    conflicts.push({ kind: 'THERAPIST_ON_LEAVE', leave });
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
  field: 'therapistId' | 'patientId';
  id: string;
  startsAt: Date;
  endsAt: Date;
  excludeId?: string;
}): Promise<AppointmentSummary[]> {
  // Two appointments overlap iff: a.startsAt < b.endsAt AND a.endsAt > b.startsAt.
  // Prisma can't express "computed endsAt" in a where clause without a raw
  // query, so we use a generous window (startsAt within +/- 12h of target)
  // and apply the precise overlap filter in JS. Combined with the partial
  // index, this is fast enough for clinical workloads.
  const windowStart = new Date(args.startsAt.getTime() - 12 * 60 * 60 * 1000);
  const windowEnd = new Date(args.endsAt.getTime() + 12 * 60 * 60 * 1000);

  const candidates = await db.appointment.findMany({
    where: {
      ...(args.field === 'therapistId' ? { therapistId: args.id } : { patientId: args.id }),
      status: { in: ACTIVE_STATUSES },
      startsAt: { gte: windowStart, lte: windowEnd },
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
    },
    include: {
      patient: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      therapist: { select: { id: true, fullNameEn: true, fullNameAr: true } },
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
      therapist: c.therapist,
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

/**
 * Test-only export of the hours-loading interface so unit tests can stub
 * ClinicSettings without hitting the DB. Production code calls
 * `checkConflicts(input)` and lets the function load hours from Prisma.
 */
export type { DayHours };
export { DAY_KEYS, type DayKey };
export type LocalizedConflictLabel = (c: Conflict, language: LanguagePref) => string;
