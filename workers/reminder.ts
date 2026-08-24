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
 *   4. Enqueues a `whatsappOutbound` job carrying the template name +
 *      parameters. The dedicated outbound worker (workers/whatsapp.ts)
 *      handles retries, rate limiting, audit, and reachability flips.
 *
 * Before Prompt 8, this worker called whatsapp.sendTemplate directly. The
 * outbound queue decouples the "should I send" decision (lives here, with
 * the domain model) from "did the send succeed" (lives in the outbound
 * worker, uniform across all senders). That uniformity is what lets the
 * Admin message log + resend action work for every kind of outbound.
 */

import { Worker } from 'bullmq';

import { db } from '@/lib/db';
import {
  appointmentVarContext,
  buildParamsFromShape,
  resolveTemplateShape,
} from '@/lib/whatsapp/templates/variables';
import { queueRedis } from '@/lib/queue/client';
import type { AppointmentReminderJob } from '@/lib/queue/jobs/appointmentReminder';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { REMINDER_QUEUE } from '@/lib/queue/queues';
import { patientDisplayName } from '@/lib/format/patientName';

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
        // P51 — an AUTO job scheduled while silent mode was OFF may fire
        // while it is ON: skip the send and re-park the entry for the
        // outbox. Admin-pressed sends (adminSend) are human-initiated and
        // pass through.
        if (!job.data.adminSend) {
          const { isSilentModeOn, reparkScheduled } = await import('@/lib/whatsapp/silent-mode');
          if (await isSilentModeOn()) {
            const TYPE = {
              confirmation: 'BOOKING_CONFIRMATION',
              reschedule: 'RESCHEDULE',
              cancellation: 'CANCELLATION',
            } as const;
            await reparkScheduled({ appointmentId, type: TYPE[kind] });
            return;
          }
        }
        const { markDispatchOutcome } = await import('@/lib/whatsapp/dispatch/outcome');
        try {
          if (kind === 'confirmation') {
            const { sendAppointmentConfirmation } =
              await import('@/lib/whatsapp/templates/sendConfirmation');
            await sendAppointmentConfirmation({ appointmentId });
          } else if (kind === 'reschedule') {
            const { sendAppointmentRescheduled } =
              await import('@/lib/whatsapp/templates/sendRescheduled');
            await sendAppointmentRescheduled({ appointmentId });
          } else {
            const { sendAppointmentCancelled } =
              await import('@/lib/whatsapp/templates/sendCancelled');
            await sendAppointmentCancelled({ appointmentId });
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
      const patientSelect = {
        id: true,
        fullNameEn: true,
        fullNameAr: true,
        phone: true,
        languagePref: true,
      } as const;
      const appt = await db.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: { select: patientSelect },
          // GROUP therapy / workshops (July #8 part 3): members live in the
          // M2M, so the reminder fans out one message per member (#6).
          groupPatients: { include: { patient: { select: patientSelect } } },
          therapists: {
            orderBy: { createdAt: 'asc' },
            include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
          },
        },
      });
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
      // Recipients: a GROUP reminds every member (#6); a single-patient
      // SESSION/STRETCHING reminds the one patient; a patient-less EVENT has
      // no one to remind (July #8) and is skipped.
      const recipients =
        appt.appointmentType === 'GROUP'
          ? appt.groupPatients.map((g) => g.patient)
          : appt.patient
            ? [appt.patient]
            : [];
      if (recipients.length === 0) {
        console.warn(`[reminder] appointment ${appointmentId} has no patient — skipping`);
        return;
      }

      // The template already names a therapist; keep naming the first-assigned
      // one rather than listing all.
      const firstTherapist = appt.therapists[0]?.therapist;

      try {
        for (const recipient of recipients) {
          // P50: phone is optional now — skip cleanly and log (the pattern
          // mirrors the P29 patient-less EVENT skip above).
          if (!recipient.phone) {
            console.warn(
              `[reminder] patient=${recipient.id} has no phone — skipping reminder for appointment=${appt.id}`,
            );
            continue;
          }
          const lang = recipient.languagePref;
          const therapistName =
            (lang === 'AR' ? firstTherapist?.fullNameAr : firstTherapist?.fullNameEn) ?? '';
          // Prompt 48b: the parameter array is built from the template ROW's
          // registered shape (legacy P45 3-var today; the v2 4-var
          // [patient, dayName, date, time] after the Admin flips SID+shape —
          // zero deploy at switch time).
          const shape = await resolveTemplateShape('appointment_reminder_v2', lang);
          if (!shape) {
            console.error('[reminder] no variable shape for appointment_reminder_v2 — skipping');
            continue;
          }
          const ctx = await appointmentVarContext({
            startsAt: appt.startsAt,
            patientName: patientDisplayName(
              recipient.fullNameEn,
              recipient.fullNameAr,
              lang === 'AR' ? 'ar' : 'en',
            ),
            therapistName,
            language: lang,
          });
          const id = await enqueueWhatsappOutbound({
            kind: 'template',
            templateName: 'appointment_reminder_v2',
            language: lang,
            parameters: buildParamsFromShape(shape, ctx),
            recipientPhone: recipient.phone,
            recipientUserId: recipient.id,
            appointmentId: appt.id,
            source: 'queue',
          });
          console.warn(
            `[reminder] appointment=${appointmentId} patient=${recipient.id} enqueued outbound=${id ?? 'n/a'}`,
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
