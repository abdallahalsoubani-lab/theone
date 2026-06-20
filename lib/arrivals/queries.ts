import { AppointmentStatus, type Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import { clinicDayRange } from './time';

/**
 * Arrivals board derivation (Prompt 18 §2, §4).
 *
 * The waiting list is DERIVED from `checkedInAt` + status — there is no
 * parallel queue table (see the model decision in the PR). Three sections,
 * all scoped to the clinic-local "today":
 *
 *   - waiting    → checked in, not yet in session (status SCHEDULED|CONFIRMED)
 *   - inSession  → status IN_PROGRESS
 *   - upNext     → bookable, not checked in, starting from now onward
 *
 * Rows carry NO phone numbers and NO clinical detail — the lobby display is a
 * staff-area screen and the serialized shape is asserted phone-free in tests.
 */

export interface ArrivalRow {
  appointmentId: string;
  patientId: string;
  patientNameEn: string;
  patientNameAr: string;
  therapistNameEn: string;
  therapistNameAr: string;
  roomName: string | null;
  startsAt: string; // ISO
  checkedInAt: string | null; // ISO
  checkedInVia: 'KIOSK' | 'STAFF' | null;
  status: AppointmentStatus;
}

export interface ArrivalsBoard {
  now: string; // ISO — render clock + "minutes waiting" against this
  currentDelayMinutes: number;
  /** Start-Session grace (minutes) so the panel can gate "Mark in session"
   *  (Fix Prompt 2). Server action remains the source of truth. */
  sessionStartGraceMinutes: number;
  waiting: ArrivalRow[];
  inSession: ArrivalRow[];
  upNext: ArrivalRow[];
}

const ROW_SELECT = {
  id: true,
  patientId: true,
  startsAt: true,
  checkedInAt: true,
  checkedInVia: true,
  status: true,
  patient: { select: { fullNameEn: true, fullNameAr: true } },
  therapists: {
    orderBy: { createdAt: 'asc' },
    include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
  },
  room: { select: { name: true } },
} satisfies Prisma.AppointmentSelect;

type RawRow = Prisma.AppointmentGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(a: RawRow): ArrivalRow {
  return {
    appointmentId: a.id,
    patientId: a.patientId,
    patientNameEn: a.patient.fullNameEn,
    patientNameAr: a.patient.fullNameAr,
    // Show every assigned therapist on the board (Prompt 20).
    therapistNameEn: a.therapists.map((t) => t.therapist.fullNameEn).join(', '),
    therapistNameAr: a.therapists.map((t) => t.therapist.fullNameAr).join('، '),
    roomName: a.room?.name ?? null,
    startsAt: a.startsAt.toISOString(),
    checkedInAt: a.checkedInAt ? a.checkedInAt.toISOString() : null,
    checkedInVia: a.checkedInVia,
    status: a.status,
  };
}

const UP_NEXT_LIMIT = 8;

export async function getArrivalsBoard(opts?: { now?: Date }): Promise<ArrivalsBoard> {
  const now = opts?.now ?? new Date();
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true, currentDelayMinutes: true, sessionStartGraceMinutes: true },
  });
  const timeZone = settings?.timezone ?? 'Asia/Amman';
  const { start, end } = clinicDayRange(now, timeZone);

  const todays = await db.appointment.findMany({
    where: { startsAt: { gte: start, lt: end } },
    orderBy: { startsAt: 'asc' },
    select: ROW_SELECT,
  });

  const waiting: ArrivalRow[] = [];
  const inSession: ArrivalRow[] = [];
  const upNext: ArrivalRow[] = [];

  for (const a of todays) {
    const row = toRow(a);
    if (a.status === AppointmentStatus.IN_PROGRESS) {
      inSession.push(row);
    } else if (
      a.checkedInAt &&
      (a.status === AppointmentStatus.SCHEDULED || a.status === AppointmentStatus.CONFIRMED)
    ) {
      waiting.push(row);
    } else if (
      !a.checkedInAt &&
      (a.status === AppointmentStatus.SCHEDULED || a.status === AppointmentStatus.CONFIRMED) &&
      a.startsAt.getTime() >= now.getTime()
    ) {
      upNext.push(row);
    }
  }

  // Waiting list ordered by arrival (earliest checked-in first) — that's the
  // queue order staff actually work.
  waiting.sort((x, y) => (x.checkedInAt ?? '').localeCompare(y.checkedInAt ?? ''));

  return {
    now: now.toISOString(),
    currentDelayMinutes: settings?.currentDelayMinutes ?? 10,
    sessionStartGraceMinutes: settings?.sessionStartGraceMinutes ?? 15,
    waiting,
    inSession,
    upNext: upNext.slice(0, UP_NEXT_LIMIT),
  };
}
