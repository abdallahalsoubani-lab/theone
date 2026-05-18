/**
 * Home-exercise reminder worker (Prompt 10 §4.7.3).
 *
 * The reminderQueue runs both appointment reminders (Prompt 7) and
 * home-exercise reminders. Jobs are dispatched by `job.name`:
 *   - 'appointment'           → existing reminder worker
 *   - 'homeExerciseReminder'  → this worker
 *
 * To keep the two workers from racing on the same queue we register
 * THIS worker only for the homeExerciseReminder name via the
 * `processor` filter. The function exits early when the job name
 * differs.
 *
 * Send path: re-read the HomeProgramItem to confirm it's still
 * active + the patient is reachable on WhatsApp, then enqueue onto
 * `whatsappOutbound`. The outbound worker from Prompt 8 handles
 * provider calls + retries + audit.
 */

import { Worker } from 'bullmq';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { queueRedis } from '@/lib/queue/client';
import type { HomeReminderJobData } from '@/lib/queue/jobs/homeExerciseReminder';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { REMINDER_QUEUE } from '@/lib/queue/queues';

export function startHomeReminderWorker(): Worker {
  const worker = new Worker<HomeReminderJobData>(
    REMINDER_QUEUE,
    async (job) => {
      if (job.name !== 'homeExerciseReminder') return;
      const { itemId } = job.data;
      const item = await db.homeProgramItem.findUnique({
        where: { id: itemId },
        include: {
          patient: {
            select: {
              id: true,
              phone: true,
              fullNameEn: true,
              fullNameAr: true,
              languagePref: true,
              whatsappReachable: true,
            },
          },
          exercise: {
            select: {
              nameEn: true,
              nameAr: true,
            },
          },
        },
      });
      if (!item) {
        console.warn(`[home-reminder] item ${itemId} no longer exists — skipping`);
        return;
      }
      if (!item.active) {
        console.warn(`[home-reminder] item ${itemId} is paused — skipping`);
        return;
      }
      if (!item.patient.whatsappReachable) {
        console.warn(
          `[home-reminder] patient ${item.patient.id} is unreachable on WhatsApp — skipping`,
        );
        return;
      }

      const language = item.patient.languagePref;
      const exerciseName = language === 'AR' ? item.exercise.nameAr : item.exercise.nameEn;
      const therapistNote = item.therapistNote ?? '';
      const portalLink = `${(env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')}/${language === 'AR' ? 'ar' : 'en'}/patient/home-program`;

      // The seeded `home_exercise_reminder` template takes three params:
      //   {{1}} = exercise name, {{2}} = therapist note, {{3}} = portal link.
      await enqueueWhatsappOutbound({
        kind: 'template',
        templateName: 'home_exercise_reminder',
        language,
        parameters: [exerciseName, therapistNote, portalLink],
        recipientPhone: item.patient.phone,
        recipientUserId: item.patient.id,
        source: 'queue',
      });
      console.warn(
        `[home-reminder] enqueued outbound for item=${itemId} patient=${item.patient.id}`,
      );
    },
    { connection: queueRedis },
  );

  worker.on('failed', (job, err) => {
    if (job?.name !== 'homeExerciseReminder') return;
    console.error(`[home-reminder] job=${job?.id ?? '<unknown>'}: ${err.message}`);
  });

  return worker;
}
