import { AppointmentStatus, AuditAction, CheckInVia, UserRole } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';

import { groupAdjacentAppointments } from './grouping';
import { notifyArrival } from './notify-arrival';
import { clinicDayRange } from './time';
import { kioskWait, type KioskWait } from './wait';

/**
 * Kiosk check-in matching (Prompt 18 §1; reworked July change requests #1/#3;
 * cards grid in Prompt 46; time-sorted rows in the July 31 bundle).
 *
 * Confirmed client decisions baked in here:
 *   - Check-in is by NAME, not phone: the patient taps their row from
 *     today's list and confirms (the confirm step lives in the kiosk UI —
 *     the server commit takes a patientId + the tapped run's anchor).
 *   - PRIVACY REVERSAL (Prompt 46, owner ruling; RE-CONFIRMED July 31):
 *     Prompt 27 §2 deliberately hid the day's full patient list behind typed
 *     search. The owner has explicitly chosen to show every patient with a
 *     today's appointment openly — full names, both scripts, no masking —
 *     accepting the trade-off as the clinic's informed decision.
 *     `listTodaysArrivalRows` is that list (one row per arrival group,
 *     checked-in rows excluded at the query layer).
 *   - The rejection message on the COMMIT path stays GENERIC: an unknown
 *     patientId and "no appointment today" both surface as `NO_APPOINTMENT`
 *     (the server guard is intact even though no typing path reaches it).
 *   - GROUPING (#3): a run of exactly-adjacent (zero-gap) appointments is one
 *     arrival — a single check-in marks the whole run; spaced-apart
 *     appointments each need their own check-in. `notifyArrival` fires once
 *     per arrival (the deferred item-2 message seam).
 *   - The "your turn in ~X minutes" value is computed from the patient's OWN
 *     appointment time (PT-B5 item 3). It used to echo the clinic-wide
 *     `currentDelayMinutes` setting, which made it the same number for every
 *     patient and a future countdown for an appointment that had passed.
 *     Still no queue-position math — just now vs. the slot, server-side.
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
      /** Computed from the patient's OWN appointment time (PT-B5 item 3),
       *  not the clinic-wide delay this used to echo. */
      wait: KioskWait;
      /** How many appointments this one arrival covered (back-to-back run). */
      appointmentCount: number;
    }
  | { kind: 'ALREADY_CHECKED_IN'; firstName: string; wait: KioskWait }
  | { kind: 'NO_APPOINTMENT' };

/** One kiosk ROW = one arrival group (July 31 item 2): a back-to-back run of
 *  still-open appointments for one patient. Spaced-apart appointments are
 *  separate rows; checked-in arrivals are excluded at the query layer (the
 *  row disappears — no ✓ state, superseding the Prompt 46 card behavior). */
export interface KioskArrivalRow {
  patientId: string;
  fullNameEn: string;
  fullNameAr: string;
  /** The run's appointments, ascending. The first start is the row's time;
   *  the confirm screen lists all of them. */
  appointments: { id: string; startsAtIso: string; durationMinutes: number }[];
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
 * Today's remaining arrivals as time-sorted rows (July 31 item 2 — replaces
 * the Prompt 46 per-patient cards; the open-names privacy ruling carries
 * over unchanged, see the module doc). Eligibility per appointment is
 * unchanged: today, SCHEDULED/CONFIRMED, scheduled end not yet passed
 * (Prompt 31 §4.4). Checked-in appointments are excluded HERE — the row's
 * disappearance is data-driven, so a secretary manual check-in removes it on
 * the kiosk's next poll too. One row per back-to-back run; ascending by the
 * run's first start. Name + times only — never phone.
 */
export async function listTodaysArrivalRows(
  input: { now?: Date } = {},
): Promise<KioskArrivalRow[]> {
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
    .flatMap((p) => {
      // Not arrivable: already ended (§4.4) or already checked in (item 2 —
      // the query layer is what makes the row disappear).
      const open = p.appointmentsAsPatient.filter((a) => endsAfter(a, now) && !a.checkedInAt);
      // One row per back-to-back run — the same grouping the check-in commit
      // uses, so a row always maps 1:1 onto one arrival.
      return groupAdjacentAppointments(open).map((run) => ({
        patientId: p.id,
        fullNameEn: p.fullNameEn,
        fullNameAr: p.fullNameAr,
        appointments: run.map((a) => ({
          id: a.id,
          startsAtIso: a.startsAt.toISOString(),
          durationMinutes: a.durationMinutes,
        })),
      }));
    })
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
  /** The tapped row's first appointment (July 31 item 2) — anchors the
   *  commit to THAT run, so tapping a later spaced-apart row checks in that
   *  row and not the next-upcoming one. Omitted → legacy next-upcoming
   *  targeting. */
  appointmentId?: string;
  now?: Date;
}): Promise<KioskCheckInResult> {
  const now = input.now ?? new Date();

  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true },
  });
  const timeZone = settings?.timezone ?? 'Asia/Amman';
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
    // Everything today is already checked in — count down to whichever of
    // those slots is still ahead.
    const next = arrivable.find((c) => c.startsAt.getTime() >= now.getTime()) ?? arrivable[0]!;
    return {
      kind: 'ALREADY_CHECKED_IN',
      firstName: greetName,
      wait: kioskWait(now, next.startsAt, timeZone),
    };
  }

  // Target: the anchored appointment when the row passed one (item 2 —
  // stale anchors resolve safely: unknown id → generic rejection; already
  // arrived → ALREADY_CHECKED_IN, never a second arrival). Without an
  // anchor: the next upcoming still-open appointment; if the patient is
  // late for the day's last slot, fall back to the earliest still-open one.
  let target: (typeof open)[number];
  if (input.appointmentId) {
    const anchored = arrivable.find((c) => c.id === input.appointmentId);
    if (!anchored) return { kind: 'NO_APPOINTMENT' };
    if (anchored.checkedInAt) {
      return {
        kind: 'ALREADY_CHECKED_IN',
        firstName: greetName,
        wait: kioskWait(now, anchored.startsAt, timeZone),
      };
    }
    target = anchored;
  } else {
    target = open.find((c) => c.startsAt.getTime() >= now.getTime()) ?? open[0]!;
  }

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

  // The countdown belongs to the slot the patient is actually waiting for —
  // the first of the run they just checked in for.
  return {
    kind: 'CHECKED_IN',
    firstName: greetName,
    wait: kioskWait(now, run[0]!.startsAt, timeZone),
    appointmentCount: run.length,
  };
}

/**
 * Staff manual check-in (July 31 item 3): the arrivals-panel path now runs
 * through the same arrival seam as the kiosk. Documented rule (owner):
 * EVERY successful check-in COMMIT sends the arrival message — undo sends
 * nothing, a re-check-in after undo sends again. The transition guard here
 * is what keeps repeats silent: an already-checked-in appointment returns
 * without writing or messaging, so double-clicks/races can't double-message.
 * Patient-less bookings (EVENT / GROUP, Prompt 29/30) check in without a
 * message — there is no single recipient to notify.
 */
export async function manualCheckIn(args: {
  appointmentId: string;
  actorId: string;
  at?: Date;
}): Promise<{ kind: 'CHECKED_IN' | 'ALREADY_CHECKED_IN' | 'NOT_FOUND' }> {
  const appt = await db.appointment.findUnique({
    where: { id: args.appointmentId },
    select: { id: true, patientId: true, checkedInAt: true },
  });
  if (!appt) return { kind: 'NOT_FOUND' };
  if (appt.checkedInAt) return { kind: 'ALREADY_CHECKED_IN' };

  await recordCheckIn({
    appointmentId: appt.id,
    via: CheckInVia.STAFF,
    actorId: args.actorId,
    at: args.at ?? new Date(),
  });
  // Manual check-in is per appointment — each commit is its own arrival.
  if (appt.patientId) await notifyArrival(appt.patientId, [appt.id]);
  return { kind: 'CHECKED_IN' };
}
