import { AuditAction, UserRole } from '@prisma/client';

import { clinicDayRange } from '@/lib/arrivals/time';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { createNotification } from '@/lib/notifications/actions';

import { WAITLIST_ERRORS, WaitlistError } from './errors';
import { matchWaitlistEntries, type FreedSlot } from './matching';
import type { WaitlistAddParsed } from './schemas';

export function waitlistToLocalized(err: unknown): LocalizedError {
  if (err instanceof WaitlistError) return err.error;
  return toLocalizedError(err);
}

async function clinicTimeZone(): Promise<string> {
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true },
  });
  return settings?.timezone ?? 'Asia/Amman';
}

/** Clinic-local 24h "HH:MM" for a UTC instant — used in the notification body. */
function clinicTime(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

// ─── Add ──────────────────────────────────────────────────────────────────

export const addWaitlistEntry = withAudit<[WaitlistAddParsed, string], { id: string }>(
  {
    entityType: 'WaitlistEntry',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.id,
    extractAfter: (result) => ({ event: 'WAITLIST_ADDED', id: result.id }),
  },
  async function addInner(input, actorId): Promise<{ id: string }> {
    // desiredDate is the clinic-local day the window sits in (UTC midnight),
    // derived so the (date, status) index + page grouping stay consistent.
    const tz = await clinicTimeZone();
    const desiredDate = clinicDayRange(input.windowStart, tz).start;
    const row = await db.waitlistEntry.create({
      data: {
        patientId: input.patientId,
        desiredDate,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        preferredTherapistId: input.preferredTherapistId ?? null,
        note: input.note ?? null,
        createdById: actorId,
      },
      select: { id: true },
    });
    return row;
  },
);

// ─── Remove ─────────────────────────────────────────────────────────────────

export const removeWaitlistEntry = withAudit<[{ id: string }], { id: string }>(
  {
    entityType: 'WaitlistEntry',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'WAITLIST_REMOVED' }),
  },
  async function removeInner({ id }): Promise<{ id: string }> {
    const existing = await db.waitlistEntry.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) throw new WaitlistError(WAITLIST_ERRORS.NOT_FOUND);
    if (existing.status !== 'WAITING') throw new WaitlistError(WAITLIST_ERRORS.NOT_WAITING);
    await db.waitlistEntry.update({ where: { id }, data: { status: 'REMOVED' } });
    return { id };
  },
);

// ─── Fulfill (after a one-click placement booked an appointment) ────────────

export const fulfillWaitlistEntry = withAudit<
  [{ entryId: string; appointmentId: string }, string],
  { id: string; appointmentId: string }
>(
  {
    entityType: 'WaitlistEntry',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].entryId,
    extractAfter: (result) => ({
      event: 'WAITLIST_FULFILLED',
      appointmentId: result.appointmentId,
    }),
  },
  async function fulfillInner(
    { entryId, appointmentId },
    actorId,
  ): Promise<{ id: string; appointmentId: string }> {
    // Race-safe single-shot: the WHERE clause pins status = WAITING, so a
    // second placement attempt on an already-fulfilled entry touches zero
    // rows and is rejected (no auto-booking, no double-fulfilment — §5).
    const res = await db.waitlistEntry.updateMany({
      where: { id: entryId, status: 'WAITING' },
      data: {
        status: 'FULFILLED',
        fulfilledById: actorId,
        fulfilledAt: new Date(),
        fulfilledAppointmentId: appointmentId,
      },
    });
    if (res.count === 0) {
      const exists = await db.waitlistEntry.findUnique({
        where: { id: entryId },
        select: { id: true },
      });
      throw new WaitlistError(
        exists ? WAITLIST_ERRORS.ALREADY_FULFILLED : WAITLIST_ERRORS.NOT_FOUND,
      );
    }
    return { id: entryId, appointmentId };
  },
);

// ─── Expiry (lazy, on read) ─────────────────────────────────────────────────

/**
 * Flip every WAITING entry whose window has fully passed to EXPIRED. Lazy —
 * called when the management page / badge is read (chosen over a worker: it
 * needs no new queue wiring, and the matcher already structurally skips passed
 * windows, so an un-swept entry can never wrongly notify). Returns the count.
 */
export async function expirePastWaitlistEntries(now: Date = new Date()): Promise<number> {
  const res = await db.waitlistEntry.updateMany({
    where: { status: 'WAITING', windowEnd: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  return res.count;
}

// ─── Slot-freed → notify (called from cancel / no-show after commit) ────────

/**
 * A slot just freed (cancellation / no-show). Find WAITING entries whose window
 * the freed slot falls inside (matching therapist preference) via the pure
 * matcher, and notify SECRETARY + ADMIN — naming the longest-waiting patient,
 * linking to the waitlist page for one-click placement. No match → silent.
 *
 * Best-effort: never throws (a notification hiccup must not break a cancel).
 */
export async function notifyWaitlistForFreedSlot(
  slot: FreedSlot,
  now: Date = new Date(),
): Promise<{ matched: number }> {
  try {
    const candidates = await db.waitlistEntry.findMany({
      where: { status: 'WAITING', windowEnd: { gt: now } },
      select: {
        id: true,
        windowStart: true,
        windowEnd: true,
        preferredTherapistId: true,
        status: true,
        createdAt: true,
        patient: { select: { fullNameEn: true, fullNameAr: true } },
      },
    });

    const matches = matchWaitlistEntries(slot, candidates, now);
    const top = matches[0];
    if (!top) return { matched: 0 };

    const tz = await clinicTimeZone();
    const time = clinicTime(slot.startsAt, tz);

    const recipients = await db.user.findMany({
      where: { role: { in: [UserRole.SECRETARY, UserRole.ADMIN] }, deletedAt: null },
      select: { id: true, languagePref: true },
    });

    for (const r of recipients) {
      const patientName = r.languagePref === 'AR' ? top.patient.fullNameAr : top.patient.fullNameEn;
      void createNotification({
        recipientId: r.id,
        type: 'BOOKING_WAITLIST_SLOT_FREED',
        params: { time, patientName },
        linkPath: '/secretary/waitlist',
        relatedEntityType: 'WaitlistEntry',
        relatedEntityId: top.id,
      }).catch((err: unknown) => {
        console.error('[waitlist] slot-freed notification failed', err);
      });
    }

    return { matched: matches.length };
  } catch (err) {
    console.error('[waitlist] notifyWaitlistForFreedSlot failed', err);
    return { matched: 0 };
  }
}
