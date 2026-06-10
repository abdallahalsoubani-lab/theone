/**
 * Appointment-reminder worker.
 *
 * Started by `pnpm workers:start` — a separate Node process in production.
 * In dev it runs in the same Node process as the WhatsApp outbound worker
 * (workers/whatsapp.ts); the singleton in `lib/queue/client.ts` ensures
 * only one Redis connection.
 *
 * Job lifecycle:
 *   1. enqueueAppointmentReminder schedules a delayed job at
 *      (startsAt - reminderOffsetMinutes)
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
import { queueRedis } from '@/lib/queue/client';
import type { AppointmentReminderJob } from '@/lib/queue/jobs/appointmentReminder';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { REMINDER_QUEUE } from '@/lib/queue/queues';

export function startReminderWorker(): Worker {
  const worker = new Worker<AppointmentReminderJob>(
    REMINDER_QUEUE,
    async (job) => {
      const { appointmentId } = job.data;
      const appt = await db.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: {
            select: {
              id: true,
              fullNameEn: true,
              fullNameAr: true,
              phone: true,
              languagePref: true,
            },
          },
          therapist: { select: { fullNameEn: true, fullNameAr: true } },
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

      const lang = appt.patient.languagePref;
      const therapistName = lang === 'AR' ? appt.therapist.fullNameAr : appt.therapist.fullNameEn;
      const timeLabel = appt.startsAt.toISOString();

      const id = await enqueueWhatsappOutbound({
        kind: 'template',
        templateName: 'appointment_reminder_v2',
        language: lang,
        parameters: [therapistName, timeLabel],
        recipientPhone: appt.patient.phone,
        recipientUserId: appt.patientId,
        appointmentId: appt.id,
        source: 'queue',
      });
      console.warn(`[reminder] appointment=${appointmentId} enqueued outbound=${id ?? 'n/a'}`);
    },
    { connection: queueRedis },
  );

  worker.on('failed', (job, err) => {
    console.error(`[reminder] job ${job?.id ?? '<unknown>'} failed: ${err.message}`, err);
  });

  return worker;
}
