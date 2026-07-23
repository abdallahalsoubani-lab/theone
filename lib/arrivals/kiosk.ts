import { AppointmentStatus, AuditAction, CheckInVia, UserRole } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';

import { groupAdjacentAppointments } from './grouping';
import { notifyArrival } from './notify-arrival';
import { clinicDayRange } from './time';

/**
 * Kiosk check-in matching (Prompt 18 §1; reworked July change requests #1/#3;
 * cards grid in Prompt 46).
 *
 * Confirmed client decisions baked in here:
 *   - Check-in is by NAME, not phone: the patient taps their card from
 *     today's list and confirms (the confirm step lives in the kiosk UI —
 *     the server commit takes a patientId).
 *   - PRIVACY REVERSAL (Prompt 46, owner ruling): Prompt 27 §2 deliberately
 *     hid the day's full patient list behind typed search. The owner has
 *     explicitly chosen to show every patient with a today's appointment as
 *     a tappable card — full names, both scripts, no masking — accepting
 *     the trade-off as the clinic's informed decision.
 *     `listTodaysArrivablePatients` is that list.
 *   - The rejection message on the COMMIT path stays GENERIC: an unknown
 *     patientId and "no appointment today" both surface as `NO_APPOINTMENT`
 *     (the server guard is intact even though no typing path reaches it).
 *   - GROUPING (#3): a run of exactly-adjacent (zero-gap) appointments is one
 *     arrival — a single check-in marks the whole run; spaced-apart
 *     appointments each need their own check-in. `notifyArrival` fires once
 *     per arrival (the deferred item-2 message seam).
 *   - The "your turn in ~X minutes" value is the manual `currentDelayMinutes`
 *     clinic setting — no queue-position math.
 *   - PASSED = GONE (Prompt 31 §4.4, supersedes Prompt 22 §4.3): an
 *     appointment whose scheduled END is already behind us is no longer
 *     arrivable — it neither matches in search nor checks in. A patient with
 *     nothing else arrivable today gets the same generic `NO_APPOINTMENT`
 *     (no lateness-specific copy; privacy stance unchanged).
 *
 * Pure of HTTP concerns: token + rate-limit gating live in the server action
 * that calls this. The audit actor is the PATIENT themselves; `checkedInVia`
 * records that it came from the kiosk.
 */

export type KioskCheckInResult =
  | {
      kind: 'CHECKED_IN';
      firstName: string;
      delayMinutes: number;
      /** How many appointments this one arrival covered (back-to-back run). */
      appointmentCount: number;
    }
  | { kind: 'ALREADY_CHECKED_IN'; firstName: string; delayMinutes: number }
  | { kind: 'NO_APPOINTMENT' };

/** One patient card — name in both scripts + today's arrivable appointment
 *  times + whether their whole day is already checked in. */
export interface KioskPatientCard {
  patientId: string;
  fullNameEn: string;
  fullNameAr: string;
  appointments: { id: string; startsAtIso: string; durationMinutes: number }[];
  /** Every arrivable appointment today is already checked in — the card
   *  renders in its ✓ state instead of dropping off the grid. */
  checkedIn: boolean;
}

const BOOKABLE: AppointmentStatus[] = [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED];

/** Prompt 31 §4.4 — arrivable = the scheduled end hasn't passed yet.
 *  (Prisma can't compare `startsAt + durationMinutes` in a where clause, so
 *  callers fetch today's rows and filter here.) */
function endsAfter(appt: { startsAt: Date; durationMinutes: number }, now: Date): boolean {
  return appt.startsAt.getTime() + appt.durationMinutes * 60_000 > now.getTime();
}

/** First whitespace-delimited token of a full name — for the greeting. */
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

/**
 * Mark an appointment as arrived, audited. Used by both the kiosk (actor =
 * patient, via = KIOSK) and staff manual check-in (actor = staff, via = STAFF,
 * passed via `actorId`).
 */
export async function recordCheckIn(args: {
  appointmentId: string;
  via: CheckInVia;
  actorId: string;
  at: Date;
}): Promise<void> {
  const audited = withAudit<[], { appointmentId: string }>(
    {
      entityType: 'Appointment',
      action: AuditAction.UPDATE,
      extractEntityId: () => args.appointmentId,
      actorOverride: async () => args.actorId,
      extractAfter: () => ({ event: 'PATIENT_CHECKED_IN', via: args.via }),
    },
    async function inner(): Promise<{ appointmentId: string }> {
      await db.appointment.update({
        where: { id: args.appointmentId },
        data: { checkedInAt: args.at, checkedInVia: args.via },
      });
      return { appointmentId: args.appointmentId };
    },
  );
  await audited();
}

/**
 * Today's arrivable patients as tappable cards (Prompt 46 — replaces the
 * typed-name search; see the privacy-reversal note in the module doc).
 * Eligibility per appointment is unchanged from the search era: today,
 * SCHEDULED/CONFIRMED, scheduled end not yet passed (Prompt 31 §4.4).
 * Already-fully-checked-in patients stay on the grid with `checkedIn: true`.
 * Sorted by next arrivable appointment time. Name + times only — never phone.
 */
export async function listTodaysArrivablePatients(
  input: { now?: Date } = {},
): Promise<KioskPatientCard[]> {
  const now = input.now ?? new Date();
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true },
  });
  const timeZone = settings?.timezone ?? 'Asia/Amman';
  const { start, end } = clinicDayRange(now, timeZone);

  const todaysApptFilter = { startsAt: { gte: start, lt: end }, status: { in: BOOKABLE } } as const;

  const patients = await db.user.findMany({
    where: {
      role: UserRole.PATIENT,
      deletedAt: null,
      // Only patients who actually have a bookable appointment TODAY.
      appointmentsAsPatient: { some: todaysApptFilter },
    },
    select: {
      id: true,
      fullNameEn: true,
      fullNameAr: true,
      appointmentsAsPatient: {
        where: todaysApptFilter,
        orderBy: { startsAt: 'asc' },
        select: { id: true, startsAt: true, durationMinutes: true, checkedInAt: true },
      },
    },
  });

  return patients
    .map((p) => {
      // Already-ended appointments are not arrivable (§4.4) — a patient whose
      // every appointment has passed simply has no card.
      const arrivable = p.appointmentsAsPatient.filter((a) => endsAfter(a, now));
      return {
        patientId: p.id,
        fullNameEn: p.fullNameEn,
        fullNameAr: p.fullNameAr,
        appointments: arrivable.map((a) => ({
          id: a.id,
          startsAtIso: a.startsAt.toISOString(),
          durationMinutes: a.durationMinutes,
        })),
        checkedIn: arrivable.length > 0 && arrivable.every((a) => a.checkedInAt !== null),
      };
    })
    .filter((p) => p.appointments.length > 0)
    .sort(
      (a, b) =>
        new Date(a.appointments[0]!.startsAtIso).getTime() -
        new Date(b.appointments[0]!.startsAtIso).getTime(),
    );
}

/**
 * Commit a check-in for the selected patient (July #1 confirm → #3 grouping).
 * Marks arrival for the current appointment AND its back-to-back run (one
 * arrival); spaced-apart appointments are left for their own later check-in.
 * `notifyArrival` fires once for the run (deferred item-2 message seam).
 */
export async function checkInByName(input: {
  patientId: string;
  now?: Date;
}): Promise<KioskCheckInResult> {
  const now = input.now ?? new Date();

  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true, currentDelayMinutes: true },
  });
  const timeZone = settings?.timezone ?? 'Asia/Amman';
  const delayMinutes = settings?.currentDelayMinutes ?? 10;
  const { start, end } = clinicDayRange(now, timeZone);

  const patient = await db.user.findFirst({
    where: { id: input.patientId, role: UserRole.PATIENT, deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true },
  });
  if (!patient) return { kind: 'NO_APPOINTMENT' };

  const candidates = await db.appointment.findMany({
    where: { patientId: patient.id, startsAt: { gte: start, lt: end }, status: { in: BOOKABLE } },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, durationMinutes: true, checkedInAt: true },
  });

  // §4.4 — an appointment whose scheduled end has passed is no longer
  // arrivable. With nothing else arrivable today the answer is the same
  // generic rejection as "no appointment at all" (no lateness copy).
  const arrivable = candidates.filter((c) => endsAfter(c, now));
  if (arrivable.length === 0) return { kind: 'NO_APPOINTMENT' };

  const greetName = firstName(patient.fullNameEn || patient.fullNameAr);

  // Already-arrived appointments are excluded from (re-)grouping. If nothing is
  // left open, the patient already checked in for everything today.
  const open = arrivable.filter((c) => !c.checkedInAt);
  if (open.length === 0) {
    return { kind: 'ALREADY_CHECKED_IN', firstName: greetName, delayMinutes };
  }

  // Target = the next upcoming still-open appointment; if the patient is late
  // for the day's last slot, fall back to the earliest still-open one.
  const target = open.find((c) => c.startsAt.getTime() >= now.getTime()) ?? open[0]!;

  // The arrival covers the back-to-back run that contains the target; other
  // runs (spaced apart) stay open for their own check-in later.
  const runs = groupAdjacentAppointments(open);
  const run = runs.find((r) => r.some((a) => a.id === target.id)) ?? [target];

  for (const appt of run) {
    await recordCheckIn({
      appointmentId: appt.id,
      via: CheckInVia.KIOSK,
      actorId: patient.id,
      at: now,
    });
  }
  // One arrival → one notification (deferred no-op; item 2).
  await notifyArrival(
    patient.id,
    run.map((a) => a.id),
  );

  return { kind: 'CHECKED_IN', firstName: greetName, delayMinutes, appointmentCount: run.length };
}
