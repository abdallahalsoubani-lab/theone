import { AuditAction } from '@prisma/client';
import type { WaDispatchMode, WaDispatchStatus, WaDispatchType } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';
import {
  cancelLifecycleMessages,
  scheduleLifecycleMessage,
  type LifecycleKind,
} from '@/lib/queue/jobs/appointmentReminder';

import { isStale } from './stale';
import { isSilentModeOn } from '../silent-mode';

/**
 * P48 — WhatsApp dispatch control.
 *
 * One funnel for every appointment message EVENT (booking / reschedule /
 * cancellation). Each event creates (or supersedes) a WhatsAppDispatch
 * ledger entry, then either schedules the P53 deferred lifecycle job
 * (AUTO / safety exception) or parks the entry for the admin outbox
 * (MANUAL). The P17 reminder pipeline is a SEPARATE flow and is never
 * touched here.
 *
 * Last-state-wins: a new event on an appointment supersedes every open
 * (PENDING/SCHEDULED) entry for it and removes its queued jobs — the
 * patient only ever receives the FINAL state. Two special rules:
 *   - cancel before the booking confirmation ever left → BOTH close
 *     silently (the patient never knew the booking existed);
 *   - reschedule before the confirmation left → the entry is re-issued
 *     as a fresh CONFIRMATION with the new time (from the patient's
 *     viewpoint it is still their first notice) — the long-standing P53
 *     rule, now recorded in the ledger.
 *
 * The <24h safety exception is REMOVED (owner order, 19 Aug 2026): MANUAL
 * now means the message NEVER leaves without the admin pressing Send in
 * the outbox, no matter how close the appointment is. The historical
 * SAFETY_EXCEPTION enum member stays for old ledger rows; nothing writes
 * it any more.
 */

/** The three P48 appointment-EVENT types (the P51 held classes —
 *  REMINDER / HOME_PROGRAM / ARRIVAL — ride other queues on Send). */
export type WaEventType = 'BOOKING_CONFIRMATION' | 'RESCHEDULE' | 'CANCELLATION';

export const KIND_BY_TYPE: Record<WaEventType, LifecycleKind> = {
  BOOKING_CONFIRMATION: 'confirmation',
  RESCHEDULE: 'reschedule',
  CANCELLATION: 'cancellation',
};

export interface DispatchTypeSettings {
  mode: WaDispatchMode;
  delayMinutes: number;
}

export async function getDispatchSettings(): Promise<Record<WaEventType, DispatchTypeSettings>> {
  const s = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: {
      bookingDispatchMode: true,
      rescheduleDispatchMode: true,
      cancellationDispatchMode: true,
      bookingConfirmationDelayMinutes: true,
      rescheduleMessageDelayMinutes: true,
      cancellationMessageDelayMinutes: true,
    },
  });
  return {
    BOOKING_CONFIRMATION: {
      mode: s?.bookingDispatchMode ?? 'AUTO',
      delayMinutes: s?.bookingConfirmationDelayMinutes ?? 0,
    },
    RESCHEDULE: {
      mode: s?.rescheduleDispatchMode ?? 'AUTO',
      delayMinutes: s?.rescheduleMessageDelayMinutes ?? 0,
    },
    CANCELLATION: {
      mode: s?.cancellationDispatchMode ?? 'AUTO',
      delayMinutes: s?.cancellationMessageDelayMinutes ?? 0,
    },
  };
}

const OPEN: WaDispatchStatus[] = ['PENDING', 'SCHEDULED'];

export interface DispatchEventResult {
  /** The freshly created entry id — null when nothing was created. */
  entryId: string | null;
  /** 'SILENT_CLOSE' = booking+cancel before send → nothing sent. */
  suppressed: 'NOTIFY_OFF' | 'SILENT_CLOSE' | null;
  /** A not-yet-sent booking confirmation existed (entry OR pre-P48 queued
   *  job) — the single-cancel path uses this for the series retarget. */
  confirmWasPending: boolean;
}

/**
 * THE event funnel (§4.1 + §4.2). Call on booking / reschedule / cancel.
 *
 * `notify=false` (the cancel modal's "don't notify" checkbox) still
 * supersedes open entries + removes queued jobs — the patient must not
 * receive a stale message about an appointment that changed — but creates
 * no new entry.
 *
 * `confirmationSent` — has a booking confirmation ACTUALLY gone out?
 * (message-log truth via confirmationAlreadySent; the series-cancel path
 * passes its own series-wide answer.)
 */
export async function recordDispatchEvent(args: {
  appointmentId: string;
  patientId: string | null;
  startsAt: Date;
  type: WaDispatchType;
  notify?: boolean;
  confirmationSent?: boolean;
}): Promise<DispatchEventResult> {
  const notify = args.notify ?? true;

  // 1) Supersede every open entry for this appointment (any type) and drop
  //    its queued jobs — one mechanism, shared with the pre-P48 P53 path.
  const open = await db.whatsAppDispatch.findMany({
    where: { appointmentId: args.appointmentId, status: { in: OPEN } },
    select: { id: true, type: true },
  });
  const { confirmWasPending: jobWasPending } = await cancelLifecycleMessages(args.appointmentId);
  const openConfirmation = open.some((e) => e.type === 'BOOKING_CONFIRMATION') || jobWasPending;

  const closeOpen = async (supersededById: string | null) => {
    if (open.length === 0) return;
    await db.whatsAppDispatch.updateMany({
      where: { id: { in: open.map((e) => e.id) } },
      data: { status: 'SUPERSEDED', supersededById },
    });
  };

  if (!notify) {
    await closeOpen(null);
    return { entryId: null, suppressed: 'NOTIFY_OFF', confirmWasPending: openConfirmation };
  }

  const confirmationSent =
    args.confirmationSent ??
    (await import('@/lib/whatsapp/templates/sendConfirmation').then((m) =>
      m.confirmationAlreadySent(args.appointmentId),
    ));

  // 2) Special case — cancel before the booking confirmation ever left:
  //    close everything, send NOTHING (§4.2).
  if (args.type === 'CANCELLATION' && openConfirmation && !confirmationSent) {
    await closeOpen(null);
    console.warn(
      `[dispatch] appointment ${args.appointmentId}: cancelled before its confirmation left — nothing sent (silent close)`,
    );
    return { entryId: null, suppressed: 'SILENT_CLOSE', confirmWasPending: openConfirmation };
  }

  // 3) Special case — reschedule before the confirmation left: the patient's
  //    first notice is still a CONFIRMATION, with the new time (P53 §1.3).
  const effectiveType: WaDispatchType =
    args.type === 'RESCHEDULE' && !confirmationSent ? 'BOOKING_CONFIRMATION' : args.type;

  // The mode alone decides (safety exception removed, owner order 19 Aug):
  // AUTO schedules the deferred job; MANUAL parks the entry for the outbox
  // and NOTHING leaves until the admin presses Send.
  // P51: the silent-mode master switch overrides the per-type mode — while
  // ON, even an AUTO type parks (one gate, consulted live). Jobs already
  // in flight are re-checked at fire time by the worker.
  const settings = (await getDispatchSettings())[effectiveType as WaEventType];
  const autoSend = settings.mode === 'AUTO' && !(await isSilentModeOn());

  const entry = await db.whatsAppDispatch.create({
    data: {
      type: effectiveType,
      appointmentId: args.appointmentId,
      patientId: args.patientId,
      status: autoSend ? 'SCHEDULED' : 'PENDING',
      dispatchReason: autoSend ? 'AUTO' : null,
    },
    select: { id: true },
  });
  await closeOpen(entry.id);

  if (autoSend) {
    const jobId = await scheduleLifecycleMessage({
      appointmentId: args.appointmentId,
      startsAt: args.startsAt,
      kind: KIND_BY_TYPE[effectiveType as WaEventType],
      delayMinutes: settings.delayMinutes,
    });
    if (jobId === null) {
      // Past-start booking/reschedule — the lifecycle layer skipped it.
      await db.whatsAppDispatch.update({
        where: { id: entry.id },
        data: { status: 'FAILED', failureReason: 'appointment already started' },
      });
      return { entryId: entry.id, suppressed: null, confirmWasPending: openConfirmation };
    }
  }

  return { entryId: entry.id, suppressed: null, confirmWasPending: openConfirmation };
}

// ─── Manual outbox operations (ADMIN — P48 §4.3) ───────────────────────────

/**
 * Send every PENDING entry of one type. Idempotent — with nothing pending
 * it returns count 0 and writes no audit row noise (the action layer shows
 * a no-op toast). One audit row per batch with the ids.
 */
export const sendOutboxBatch = withAudit<
  [{ type: WaDispatchType; adminId: string }],
  { count: number; entryIds: string[]; staleIds: string[] }
>(
  {
    entityType: 'WhatsAppDispatch',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].type,
    extractAfter: (result) => ({
      event: 'OUTBOX_BATCH_SENT',
      count: result.count,
      entryIds: result.entryIds,
      // P51 — rows auto-marked STALE by this Send (audited here).
      staleIds: result.staleIds,
    }),
  },
  async function sendOutboxInner(args): Promise<{
    count: number;
    entryIds: string[];
    staleIds: string[];
  }> {
    const pending = await db.whatsAppDispatch.findMany({
      where: { type: args.type, status: 'PENDING' },
      select: { id: true, appointmentId: true, patientId: true, homeProgramItemId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (pending.length === 0) return { count: 0, entryIds: [], staleIds: [] };

    const apptIds = pending.map((p) => p.appointmentId).filter((x): x is string => Boolean(x));
    const appts = await db.appointment.findMany({
      where: { id: { in: apptIds } },
      select: { id: true, startsAt: true, durationMinutes: true, status: true },
    });
    const apptById = new Map(appts.map((a) => [a.id, a]));

    const now = new Date();
    const sentIds: string[] = [];
    const staleIds: string[] = [];
    for (const entry of pending) {
      const appt = entry.appointmentId ? apptById.get(entry.appointmentId) : undefined;
      // P51 §4.5 — a held message must not outlive its moment: stale rows
      // are marked (audited via this batch's audit row) and never send.
      if (
        isStale(
          {
            type: args.type,
            status: 'PENDING',
            appointmentStartsAt: appt?.startsAt ?? null,
            appointmentDurationMinutes: appt?.durationMinutes ?? null,
            appointmentStatus: appt?.status ?? null,
          },
          now,
        )
      ) {
        await db.whatsAppDispatch.update({
          where: { id: entry.id },
          data: { status: 'STALE', failureReason: 'stale at send time' },
        });
        staleIds.push(entry.id);
        continue;
      }
      await db.whatsAppDispatch.update({
        where: { id: entry.id },
        data: { status: 'SCHEDULED', dispatchReason: 'MANUAL', sentById: args.adminId },
      });
      // The admin pressed Send — a human action, so the job carries
      // adminSend and bypasses the silent-mode gate at fire time.
      const jobId = await scheduleOutboxSend({
        type: args.type,
        appointmentId: entry.appointmentId,
        homeProgramItemId: entry.homeProgramItemId,
        startsAt: appt?.startsAt ?? null,
      }).catch(() => null);
      if (jobId === null) {
        await db.whatsAppDispatch.update({
          where: { id: entry.id },
          data: { status: 'FAILED', failureReason: 'appointment already started' },
        });
        continue;
      }
      sentIds.push(entry.id);
    }
    return { count: sentIds.length, entryIds: sentIds, staleIds };
  },
);

/**
 * P51 — route one admin-pressed Send onto the queue matching its class.
 * Event types reuse the P48 lifecycle jobs; REMINDER/ARRIVAL ride the same
 * reminders queue under their own deterministic outbox-send job ids;
 * HOME_PROGRAM re-runs the home-reminder job (full re-validation).
 * Content is always re-derived at fire time by the same sender the
 * automatic path uses.
 */
async function scheduleOutboxSend(args: {
  type: WaDispatchType;
  appointmentId: string | null;
  homeProgramItemId: string | null;
  startsAt: Date | null;
}): Promise<string | null> {
  if (
    args.type === 'BOOKING_CONFIRMATION' ||
    args.type === 'RESCHEDULE' ||
    args.type === 'CANCELLATION'
  ) {
    if (!args.appointmentId) return null;
    return scheduleLifecycleMessage({
      appointmentId: args.appointmentId,
      startsAt: args.startsAt ?? new Date(0),
      kind: KIND_BY_TYPE[args.type],
      delayMinutes: 0,
      adminSend: true,
    });
  }
  if (args.type === 'REMINDER' || args.type === 'ARRIVAL') {
    if (!args.appointmentId) return null;
    const { reminderQueue } = await import('@/lib/queue/queues');
    const kind = args.type === 'REMINDER' ? 'reminder' : 'arrival';
    const jobId = `outbox-${kind}-${args.appointmentId}`;
    await reminderQueue.remove(jobId).catch(() => undefined);
    const job = await reminderQueue.add(
      'appointment',
      { appointmentId: args.appointmentId, kind, adminSend: true },
      { jobId },
    );
    return job.id ?? null;
  }
  // HOME_PROGRAM
  if (!args.homeProgramItemId) return null;
  const { homeProgramQueue } = await import('@/lib/queue/queues');
  const jobId = `outbox-homeprog-${args.homeProgramItemId}`;
  await homeProgramQueue.remove(jobId).catch(() => undefined);
  const job = await homeProgramQueue.add(
    'homeExerciseReminder',
    { itemId: args.homeProgramItemId, adminSend: true },
    { jobId },
  );
  return job.id ?? null;
}

/**
 * P51 — flip the master silent-mode switch (ADMIN, audited with a distinct
 * event so the toggle history is separable from ordinary settings saves).
 */
export const setSilentMode = withAudit<[{ on: boolean; adminId: string }], { on: boolean }>(
  {
    entityType: 'ClinicSettings',
    action: AuditAction.UPDATE,
    extractEntityId: () => 'default',
    extractAfter: (result) => ({
      event: result.on ? 'SILENT_MODE_ENABLED' : 'SILENT_MODE_DISABLED',
    }),
  },
  async function setSilentModeInner(args): Promise<{ on: boolean }> {
    await db.clinicSettings.update({
      where: { id: 'default' },
      data: { whatsappSilentMode: args.on, updatedById: args.adminId },
    });
    return { on: args.on };
  },
);

/** Remove one entry from its batch before sending (audited). */
export const excludeDispatchEntry = withAudit<
  [{ entryId: string; adminId: string }],
  { entryId: string }
>(
  {
    entityType: 'WhatsAppDispatch',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].entryId,
    extractAfter: () => ({ event: 'OUTBOX_ENTRY_EXCLUDED' }),
  },
  async function excludeInner(args): Promise<{ entryId: string }> {
    const entry = await db.whatsAppDispatch.findUnique({
      where: { id: args.entryId },
      select: { id: true, status: true },
    });
    if (!entry || entry.status !== 'PENDING') {
      throw new Error('DISPATCH_ENTRY_NOT_PENDING');
    }
    await db.whatsAppDispatch.update({
      where: { id: args.entryId },
      data: { status: 'EXCLUDED' },
    });
    return { entryId: args.entryId };
  },
);
