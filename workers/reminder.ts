/**
 * Appointment-reminder worker.
 *
 * Started by `pnpm workers:start` — a separate Node process in production.
 * In dev it can run in the same Node process; the singleton in
 * `lib/queue/client.ts` ensures only one Redis connection.
 *
 * Job lifecycle:
 *   1. enqueueAppointmentReminder schedules a delayed job at
 *      (startsAt - reminderOffsetMinutes)
 *   2. When the delay elapses, this worker fires
 *   3. The handler re-reads the appointment from the DB to confirm it's
 *      still active (SCHEDULED or CONFIRMED) — terminal/cancelled
 *      appointments are silently skipped
 *   4. Calls `whatsapp.sendTemplate('appointment_reminder_30min', ...)`
 *      — in dev this writes `[DEV WHATSAPP]` to the console; in prod
 *      Prompt 8 swaps `WHATSAPP_PROVIDER` and the real Meta/Twilio send
 *      runs with no change to this code
 */

import { Worker } from 'bullmq';

import { db } from '@/lib/db';
import { queueRedis } from '@/lib/queue/client';
import type { AppointmentReminderJob } from '@/lib/queue/jobs/appointmentReminder';
import { REMINDER_QUEUE } from '@/lib/queue/queues';
import { whatsapp } from '@/lib/whatsapp';

export function startReminderWorker(): Worker {
  const worker = new Worker<AppointmentReminderJob>(
    REMINDER_QUEUE,
    async (job) => {
      const { appointmentId } = job.data;
      const appt = await db.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: {
            select: { fullNameEn: true, fullNameAr: true, phone: true, languagePref: true },
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

      const result = await whatsapp.sendTemplate({
        name: 'appointment_reminder_30min',
        recipientPhone: appt.patient.phone,
        language: lang,
        parameters: [therapistName, timeLabel],
        recipientUserId: appt.patientId,
      });
      console.warn(
        `[reminder] sent appointment_reminder_30min appointment=${appointmentId} ` +
          `provider-msg-id=${result.providerMessageId ?? 'n/a'} status=${result.status}`,
      );
    },
    { connection: queueRedis },
  );

  worker.on('failed', (job, err) => {
    console.error(`[reminder] job ${job?.id ?? '<unknown>'} failed: ${err.message}`, err);
  });

  return worker;
}
