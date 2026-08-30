/**
 * Home-exercise reminder worker (Prompt 10 §4.7.3).
 *
 * Subscribes to the dedicated `homeProgramReminders` queue. Separate from
 * `reminders` (appointment reminders) and `complianceChecks` to prevent
 * the multi-worker-on-same-queue race that BullMQ exhibits when several
 * workers compete for jobs and only filter by name inside the handler.
 *
 * Send path: re-read the HomeProgramItem to confirm it's still
 * active + the patient is reachable on WhatsApp, then enqueue onto
 * `whatsappOutbound`. The outbound worker from Prompt 8 handles
 * provider calls + retries + audit.
 */

import { Worker } from 'bullmq';

import { remindersActive } from '@/lib/clinical/home-program/visibility';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { queueRedis } from '@/lib/queue/client';
import type { HomeReminderJobData } from '@/lib/queue/jobs/homeExerciseReminder';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { HOME_PROGRAM_QUEUE } from '@/lib/queue/queues';

export function startHomeReminderWorker(): Worker {
  const worker = new Worker<HomeReminderJobData>(
    HOME_PROGRAM_QUEUE,
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
      // Prompt 16: only remind on APPROVED programs with reminders enabled.
      if (!(await remindersActive(item.patient.id))) {
        console.warn(
          `[home-reminder] program for patient ${item.patient.id} not approved or reminders off — skipping`,
        );
        return;
      }
      // P59 — an admin-pressed outbox Send bypasses the (possibly stale)
      // reachability flag; automatic fires still skip.
      if (!item.patient.whatsappReachable && !job.data.adminSend) {
        console.warn(
          `[home-reminder] patient ${item.patient.id} is unreachable on WhatsApp — skipping`,
        );
        return;
      }
      // P51 — silent mode holds the home-exercise reminder in the outbox
      // instead of sending (fire-time check; admin-pressed sends pass).
      if (!job.data.adminSend) {
        const { isSilentModeOn, holdForOutbox } = await import('@/lib/whatsapp/silent-mode');
        if (await isSilentModeOn()) {
          await holdForOutbox({
            type: 'HOME_PROGRAM',
            patientId: item.patient.id,
            homeProgramItemId: itemId,
          });
          return;
        }
      }

      // P50: patients may have no phone (real-clinic import) — skip cleanly,
      // never enqueue a job to nowhere.
      if (!item.patient.phone) {
        console.warn(
          `[home-reminder] patient=${item.patient.id} has no phone — skipping item=${itemId}`,
        );
        return;
      }
      const language = item.patient.languagePref;
      const exerciseName = language === 'AR' ? item.exercise.nameAr : item.exercise.nameEn;
      // Meta rejects an empty body parameter with #131008 "Required parameter
      // is missing", so {{2}} must never be blank. When the therapist left no
      // note, send a localized fallback instead of an empty/whitespace string.
      const therapistNote = item.therapistNote?.trim() || 'لا توجد ملاحظة إضافية';
      const portalLink = `${(env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')}/${language === 'AR' ? 'ar' : 'en'}/patient/home-program`;

      // The seeded `home_exercise_reminder_v2` template takes three params:
      //   {{1}} = exercise name, {{2}} = therapist note, {{3}} = portal link.
      await enqueueWhatsappOutbound({
        kind: 'template',
        templateName: 'home_exercise_reminder_v2',
        language,
        parameters: [exerciseName, therapistNote, portalLink],
        recipientPhone: item.patient.phone,
        recipientUserId: item.patient.id,
        source: 'queue',
      });
      console.warn(
        `[home-reminder] enqueued outbound for item=${itemId} patient=${item.patient.id}`,
      );
      // P51 — an outbox Send of a held row reports its outcome (no-op for
      // the normal automatic fire, which has no ledger row).
      if (job.data.adminSend) {
        await db.whatsAppDispatch.updateMany({
          where: { homeProgramItemId: itemId, type: 'HOME_PROGRAM', status: 'SCHEDULED' },
          data: { status: 'SENT', sentAt: new Date() },
        });
      }
    },
    { connection: queueRedis },
  );

  worker.on('failed', (job, err) => {
    if (job?.name !== 'homeExerciseReminder') return;
    console.error(`[home-reminder] job=${job?.id ?? '<unknown>'}: ${err.message}`);
  });

  return worker;
}
