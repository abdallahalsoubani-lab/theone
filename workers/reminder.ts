/**
 * Appointment-reminder worker.
 *
 * Started by `pnpm workers:start` — a separate Node process in production.
 * In dev it runs in the same Node process as the WhatsApp outbound worker
 * (workers/whatsapp.ts); the singleton in `lib/queue/client.ts` ensures
 * only one Redis connection.
 *
 * Job lifecycle:
 *   1. enqueueAppointmentReminder schedules ONE delayed job (Prompt 17): the
 *      appointment start minus the configured offset (default 24h), clamped to
 *      the clinic's 08:00–18:00 local reminder window.
 *   2. When the delay elapses, this worker fires
 *   3. The handler re-reads the appointment from the DB to confirm it's
 *      still active (SCHEDULED or CONFIRMED) — terminal/cancelled
 *      appointments are silently skipped
 *   4. Composes the reminder through the ONE shared builder
 *      (lib/whatsapp/templates/reminderBuilder.ts — P60: the manual panel
 *      uses the same one) and enqueues a `whatsappOutbound` job per message.
 *      The dedicated outbound worker (workers/whatsapp.ts) handles retries,
 *      rate limiting, audit, and reachability flips.
 *
 * Before Prompt 8, this worker called whatsapp.sendTemplate directly. The
 * outbound queue decouples the "should I send" decision (lives here, with
 * the domain model) from "did the send succeed" (lives in the outbound
 * worker, uniform across all senders). That uniformity is what lets the
 * Admin message log + resend action work for every kind of outbound.
 */

import { Worker } from 'bullmq';

import { db } from '@/lib/db';
import { queueRedis } from '@/lib/queue/client';
import type { AppointmentReminderJob } from '@/lib/queue/jobs/appointmentReminder';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { REMINDER_QUEUE } from '@/lib/queue/queues';
import {
  buildAppointmentReminderMessages,
  loadReminderAppointment,
} from '@/lib/whatsapp/templates/reminderBuilder';

const LIFECYCLE_TYPE = {
  confirmation: 'BOOKING_CONFIRMATION',
  reschedule: 'RESCHEDULE',
  cancellation: 'CANCELLATION',
} as const;

/**
 * P60 — a staff member may have sent the same message type by hand from the
 * appointment panel while this job was waiting; that closes the ledger row
 * (SUPERSEDED_BY_MANUAL) and removes the queued job, but a job already
 * picked up (or a removal that raced) must still no-op here. Fail-open: a
 * ledger read error keeps today's behaviour (send).
 */
async function closedByManualSend(
  appointmentId: string,
  type: (typeof LIFECYCLE_TYPE)[keyof typeof LIFECYCLE_TYPE],
): Promise<boolean> {
  try {
    const latest = await db.whatsAppDispatch.findFirst({
      where: { appointmentId, type },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    return latest?.status === 'SUPERSEDED_BY_MANUAL';
  } catch {
    return false;
  }
}

export function startReminderWorker(): Worker {
  const worker = new Worker<AppointmentReminderJob>(
    REMINDER_QUEUE,
    async (job) => {
      const { appointmentId } = job.data;
      // P53 — deferred lifecycle messages share this queue (deterministic
      // ids confirm-{id}/resched-{id}; the schedule/replace/remove logic
      // lives in lib/queue/jobs/appointmentReminder.ts). The senders
      // re-read the appointment so the patient always gets CURRENT details.
      if (
        job.data.kind === 'confirmation' ||
        job.data.kind === 'reschedule' ||
        job.data.kind === 'cancellation'
      ) {
        // P48 — every lifecycle send reports its outcome to the dispatch
        // ledger (SENT/FAILED); pre-P48 jobs without a ledger row no-op.
        const kind = job.data.kind;
        if (!job.data.adminSend) {
          // P60 — closed by a manual panel send of the same type: no-op.
          if (await closedByManualSend(appointmentId, LIFECYCLE_TYPE[kind])) {
            console.warn(
              `[lifecycle] appointment=${appointmentId} ${kind} superseded by a manual send — skipped`,
            );
            return;
          }
          // P51 — an AUTO job scheduled while silent mode was OFF may fire
          // while it is ON: skip the send and re-park the entry for the
          // outbox. Admin-pressed sends (adminSend) are human-initiated and
          // pass through.
          const { isSilentModeOn, reparkScheduled } = await import('@/lib/whatsapp/silent-mode');
          if (await isSilentModeOn()) {
            await reparkScheduled({ appointmentId, type: LIFECYCLE_TYPE[kind] });
            return;
          }
        }
        const { markDispatchOutcome } = await import('@/lib/whatsapp/dispatch/outcome');
        try {
          // P59 — an admin-pressed Send must genuinely ATTEMPT the send:
          // force bypasses the (possibly stale) whatsappReachable skip, so
          // the outcome recorded is the provider's, not a silent no-op.
          const force = job.data.adminSend === true;
          if (kind === 'confirmation') {
            const { sendAppointmentConfirmation } =
              await import('@/lib/whatsapp/templates/sendConfirmation');
            await sendAppointmentConfirmation({ appointmentId, force });
          } else if (kind === 'reschedule') {
            const { sendAppointmentRescheduled } =
              await import('@/lib/whatsapp/templates/sendRescheduled');
            await sendAppointmentRescheduled({ appointmentId, force });
          } else {
            const { sendAppointmentCancelled } =
              await import('@/lib/whatsapp/templates/sendCancelled');
            await sendAppointmentCancelled({ appointmentId, force });
          }
        } catch (err) {
          await markDispatchOutcome({
            appointmentId,
            kind,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }).catch(() => undefined);
          throw err;
        }
        await markDispatchOutcome({ appointmentId, kind, ok: true }).catch(() => undefined);
        console.warn(`[lifecycle] appointment=${appointmentId} ${kind} dispatched`);
        return;
      }
      // P51 — outbox-sent arrival confirmation: re-derive via the same
      // sender the kiosk path uses, then report the outcome to the ledger.
      if (job.data.kind === 'arrival') {
        const { markDispatchOutcome } = await import('@/lib/whatsapp/dispatch/outcome');
        const row = await db.whatsAppDispatch.findFirst({
          where: { appointmentId, type: 'ARRIVAL', status: 'SCHEDULED' },
          orderBy: { createdAt: 'desc' },
          select: { patientId: true },
        });
        if (!row?.patientId) {
          console.warn(
            `[silent-mode] arrival send for ${appointmentId}: no held row/patient — skipping`,
          );
          return;
        }
        try {
          const { sendArrivalConfirmation } = await import('@/lib/whatsapp/templates/sendArrival');
          await sendArrivalConfirmation({
            patientId: row.patientId,
            appointmentIds: [appointmentId],
            // P59 — arrival jobs on this queue only exist via the outbox
            // Send button; force past the stale reachability flag.
            force: job.data.adminSend === true,
          });
        } catch (err) {
          await markDispatchOutcome({
            appointmentId,
            kind: 'arrival',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }).catch(() => undefined);
          throw err;
        }
        await markDispatchOutcome({ appointmentId, kind: 'arrival', ok: true }).catch(
          () => undefined,
        );
        console.warn(`[lifecycle] appointment=${appointmentId} arrival dispatched (outbox)`);
        return;
      }
      const appt = await loadReminderAppointment(appointmentId);
      if (!appt) {
        console.warn(`[reminder] appointment ${appointmentId} no longer exists — skipping`);
        return;
      }
      if (appt.status === 'CANCELLED' || appt.status === 'NO_SHOW' || appt.status === 'COMPLETED') {
        console.warn(`[reminder] appointment ${appointmentId} status=${appt.status} — skipping`);
        return;
      }
      if (appt.startsAt.getTime() < Date.now()) {
        console.warn(`[reminder] appointment ${appointmentId} already past — skipping`);
        return;
      }
      // P51 — silent mode holds the reminder in the outbox INSTEAD of
      // sending (decision reversal §1.4: the owner's master switch gates
      // the P17 reminder too). Fire-time check, so toggling OFF simply
      // lets future fires send normally. Admin-pressed sends pass through.
      if (!job.data.adminSend) {
        const { isSilentModeOn, holdForOutbox } = await import('@/lib/whatsapp/silent-mode');
        if (await isSilentModeOn()) {
          await holdForOutbox({
            type: 'REMINDER',
            appointmentId: appt.id,
            patientId: appt.patientId,
          });
          return;
        }
      }

      try {
        // P60 — one shared composer (the manual panel uses the same one).
        const messages = await buildAppointmentReminderMessages(appt);
        for (const m of messages) {
          const id = await enqueueWhatsappOutbound({
            kind: 'template',
            templateName: m.templateName,
            language: m.language,
            parameters: m.parameters,
            recipientPhone: m.recipientPhone,
            recipientUserId: m.recipientUserId,
            appointmentId: m.appointmentId,
            source: 'queue',
          });
          console.warn(
            `[reminder] appointment=${m.appointmentId ?? appointmentId} patient=${m.recipientUserId ?? '?'} template=${m.templateName} enqueued outbound=${id ?? 'n/a'}`,
          );
        }
      } catch (err) {
        if (job.data.adminSend) {
          const { markDispatchOutcome } = await import('@/lib/whatsapp/dispatch/outcome');
          await markDispatchOutcome({
            appointmentId,
            kind: 'reminder',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }).catch(() => undefined);
        }
        throw err;
      }
      // P51 — when this fire was an outbox Send of a held reminder, report
      // the outcome to the ledger (no-op when no SCHEDULED row exists —
      // the normal silent-OFF automatic fire).
      if (job.data.adminSend) {
        const { markDispatchOutcome } = await import('@/lib/whatsapp/dispatch/outcome');
        await markDispatchOutcome({ appointmentId, kind: 'reminder', ok: true }).catch(
          () => undefined,
        );
      }
    },
    { connection: queueRedis },
  );

  worker.on('failed', (job, err) => {
    console.error(`[reminder] job ${job?.id ?? '<unknown>'} failed: ${err.message}`, err);
  });

  return worker;
}
