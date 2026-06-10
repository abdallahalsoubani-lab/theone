import { AppointmentStatus, AuditAction, CheckInVia, UserRole } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';
import { normalizeJordanPhone } from '@/lib/format/phone';

import { clinicDayRange } from './time';

/**
 * Kiosk check-in matching (Prompt 18 §1).
 *
 * Confirmed client decisions baked in here:
 *   - The rejection message is GENERIC: unknown phone and "no appointment
 *     today" return the SAME `NO_APPOINTMENT` kind. We never reveal whether a
 *     phone exists in the system (patient-enumeration guard).
 *   - The "your turn in ~X minutes" value is the manual `currentDelayMinutes`
 *     clinic setting — no queue-position math.
 *
 * Pure of HTTP concerns: token + rate-limit gating live in the server action
 * that calls this. The audit actor is the PATIENT themselves (they performed
 * their own check-in); `checkedInVia` records that it came from the kiosk.
 */

export type KioskCheckInResult =
  | { kind: 'CHECKED_IN'; firstName: string; delayMinutes: number }
  | { kind: 'ALREADY_CHECKED_IN'; firstName: string; delayMinutes: number }
  | { kind: 'NO_APPOINTMENT' };

const BOOKABLE: AppointmentStatus[] = [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED];

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
 * Match a typed phone to a patient + a TODAY appointment and check them in.
 * Returns a discriminated result the kiosk UI renders directly.
 */
export async function checkInByPhone(input: {
  phone: string;
  now?: Date;
}): Promise<KioskCheckInResult> {
  const now = input.now ?? new Date();
  const normalized = normalizeJordanPhone(input.phone);
  // Invalid shape → generic rejection (never reveal validity).
  if (!normalized) return { kind: 'NO_APPOINTMENT' };

  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true, currentDelayMinutes: true },
  });
  const timeZone = settings?.timezone ?? 'Asia/Amman';
  const delayMinutes = settings?.currentDelayMinutes ?? 10;
  const { start, end } = clinicDayRange(now, timeZone);

  const patient = await db.user.findFirst({
    where: { phone: normalized, role: UserRole.PATIENT, deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true },
  });
  if (!patient) return { kind: 'NO_APPOINTMENT' };

  // Today's still-bookable appointments for this patient, earliest first.
  const candidates = await db.appointment.findMany({
    where: {
      patientId: patient.id,
      startsAt: { gte: start, lt: end },
      status: { in: BOOKABLE },
    },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, checkedInAt: true },
  });
  if (candidates.length === 0) return { kind: 'NO_APPOINTMENT' };

  // Check into the NEXT UPCOMING appointment; if none are still ahead (patient
  // arrived late for the day's last slot) fall back to the earliest.
  const target = candidates.find((c) => c.startsAt.getTime() >= now.getTime()) ?? candidates[0];
  if (!target) return { kind: 'NO_APPOINTMENT' };

  // Greet with the patient's own name; English first token is fine for both
  // locales (the kiosk surrounds it with localized copy).
  const greetName = firstName(patient.fullNameEn || patient.fullNameAr);

  if (target.checkedInAt) {
    return { kind: 'ALREADY_CHECKED_IN', firstName: greetName, delayMinutes };
  }

  await recordCheckIn({
    appointmentId: target.id,
    via: CheckInVia.KIOSK,
    actorId: patient.id,
    at: now,
  });

  return { kind: 'CHECKED_IN', firstName: greetName, delayMinutes };
}
