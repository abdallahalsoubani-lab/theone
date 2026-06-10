/**
 * Dev-only: create a HomeProgramItem for sara.k@example.com with a fixed
 * scheduledTime + daysOfWeek, register the BullMQ repeating reminder
 * (skipping the audit wrapper which needs a session), then inspect the
 * homeProgramReminders queue to confirm the repeat job is scheduled.
 *
 *   pnpm dotenv -e .env.local -- tsx scripts/test-home-reminder.ts [HH:MM]
 */

import {
  computeReminderCron,
  registerHomeReminderJob,
  removeHomeReminderJob,
} from '@/lib/queue/jobs/homeExerciseReminder';
import { homeProgramQueue } from '@/lib/queue/queues';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

async function main() {
  const scheduledTime = process.argv[2] ?? '08:00';

  const patient = await db.user.findFirst({
    where: { email: 'sara.k@example.com' },
    select: { id: true, fullNameEn: true, languagePref: true, phone: true },
  });
  if (!patient) throw new Error('patient sara.k@example.com not found');

  const exercise = await db.exercise.findFirst({
    where: { active: true, replacedById: null },
    select: { id: true, nameEn: true, nameAr: true },
  });
  if (!exercise) throw new Error('no active exercise found');

  console.log('[home-test] patient :', patient);
  console.log('[home-test] exercise:', exercise);
  console.log('[home-test] scheduledTime:', scheduledTime);
  console.log('[home-test] daysOfWeek:', [0, 1, 2, 3, 4, 5, 6], '(every day)');
  console.log('[home-test] reminder offset:', env.HOME_REMINDER_OFFSET_MINUTES, 'min');

  // 1. Pure cron computation — no Redis hit.
  const cron = computeReminderCron({
    scheduledTime,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    offsetMinutes: env.HOME_REMINDER_OFFSET_MINUTES,
  });
  console.log('[home-test] computed cron:', cron);

  // 2. Insert the HomeProgramItem row directly (bypass the audit-gated
  //    service that needs an authenticated session).
  const item = await db.homeProgramItem.create({
    data: {
      patientId: patient.id,
      exerciseId: exercise.id,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      scheduledTime,
      durationMinutes: 15,
      setsReps: '3x10',
      therapistNote: 'Keep your back straight throughout the movement.',
      active: true,
    },
    select: { id: true },
  });
  console.log('[home-test] HomeProgramItem id=', item.id);

  // 3. Register the repeat job (same call the service makes).
  const key = await registerHomeReminderJob({
    itemId: item.id,
    scheduledTime,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    offsetMinutes: env.HOME_REMINDER_OFFSET_MINUTES,
  });
  await db.homeProgramItem.update({
    where: { id: item.id },
    data: { reminderJobKey: key },
  });
  console.log('[home-test] registered repeat-job key:', key);

  // 4. Inspect the queue.
  const repeatables = await homeProgramQueue.getRepeatableJobs();
  console.log('[home-test] repeatable jobs in homeProgramReminders queue:');
  for (const r of repeatables) {
    console.log('  ', {
      key: r.key,
      name: r.name,
      pattern: r.pattern,
      tz: r.tz,
      next: r.next ? new Date(r.next).toISOString() : null,
    });
  }

  const delayed = await homeProgramQueue.getDelayed();
  console.log('[home-test] delayed jobs:', delayed.length);
  for (const j of delayed) {
    console.log('  ', {
      id: j.id,
      name: j.name,
      timestamp: new Date(j.timestamp).toISOString(),
      delayMs: j.opts.delay,
    });
  }

  console.log('[home-test] CLEANUP: pass --keep to leave the row + job in place.');
  if (!process.argv.includes('--keep')) {
    await removeHomeReminderJob(key);
    await db.homeProgramItem.delete({ where: { id: item.id } });
    console.log('[home-test] cleaned up row + repeat job');
  }

  await db.$disconnect();
  setTimeout(() => process.exit(0), 500).unref();
}

main().catch((err) => {
  console.error('[home-test] failed:', err);
  process.exit(1);
});
