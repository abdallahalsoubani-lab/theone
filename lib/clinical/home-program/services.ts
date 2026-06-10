import { AuditAction, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { env } from '@/lib/env';
import { isClinicianAssignedTo } from '@/lib/patients/assignment';
import {
  registerHomeReminderJob,
  removeHomeReminderJob,
} from '@/lib/queue/jobs/homeExerciseReminder';

import type {
  HomeProgramItemCreateInput,
  HomeProgramItemUpdateInput,
  MarkCompleteInput,
} from './schemas';

/**
 * HomeProgramItem services (Prompt 10 §4.5-§4.6).
 *
 * Five audited mutations:
 *   - addHomeProgramItem: insert + (commit 5) register reminder cron.
 *   - updateHomeProgramItem: update + (commit 5) re-register cron.
 *   - setItemActive: pause/resume.
 *   - deleteHomeProgramItem: delete + (commit 5) remove cron.
 *   - markComplete (patient-facing): insert HomeProgramCompletion,
 *     idempotent per (itemId, scheduledDate).
 *
 * The cron registration / removal hooks land in commit 5 — for now the
 * services persist daysOfWeek + scheduledTime + reminderJobKey but
 * leave the BullMQ side empty. This keeps the domain layer testable
 * in isolation.
 */

export class HomeProgramError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'HomeProgramError';
  }
}

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};
const notFound: LocalizedError = {
  code: 'HOME_PROGRAM_NOT_FOUND',
  message_en: 'Home program item not found.',
  message_ar: 'لم يتم العثور على عنصر البرنامج المنزلي.',
};
const forbidden: LocalizedError = {
  code: 'HOME_PROGRAM_FORBIDDEN',
  message_en: 'You are not authorized to manage this home program.',
  message_ar: 'غير مصرح لك بإدارة هذا البرنامج المنزلي.',
};
const notScheduledToday: LocalizedError = {
  code: 'HOME_PROGRAM_NOT_TODAY',
  message_en: 'This exercise is not scheduled for today.',
  message_ar: 'هذا التمرين غير مجدول لليوم.',
};
const exerciseArchived: LocalizedError = {
  code: 'EXERCISE_ARCHIVED',
  message_en: 'Cannot add an archived exercise to a home program.',
  message_ar: 'لا يمكن إضافة تمرين مؤرشف إلى البرنامج المنزلي.',
};

/**
 * Resource-scope check: the Therapist managing a home program must be
 * the patient's assigned therapist (or any clinical staff via Admin).
 * Patients can only act on their own.
 */
async function ensureClinicalActorCanManage(args: {
  actorId: string;
  patientId: string;
}): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new HomeProgramError(unauthenticated);
  if (session.user.role === UserRole.ADMIN || session.user.role === UserRole.DOCTOR) return;
  if (session.user.role === UserRole.THERAPIST) {
    const onCareTeam = await isClinicianAssignedTo(args.actorId, args.patientId);
    if (!onCareTeam) {
      throw new HomeProgramError(forbidden);
    }
    return;
  }
  throw new HomeProgramError(forbidden);
}

export const addHomeProgramItem = withAudit<
  [HomeProgramItemCreateInput, { actorId: string }],
  { itemId: string }
>(
  {
    entityType: 'HomeProgramItem',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.itemId,
    extractAfter: () => ({ event: 'CREATED' }) as Prisma.InputJsonValue,
  },
  async function inner(input, ctx): Promise<{ itemId: string }> {
    await ensureClinicalActorCanManage({ actorId: ctx.actorId, patientId: input.patientId });

    // Block adding archived / superseded exercises to a new home program.
    // Existing rows referencing the old version remain valid (no cascade).
    const exercise = await db.exercise.findUnique({
      where: { id: input.exerciseId },
      select: { id: true, active: true, replacedById: true },
    });
    if (!exercise) {
      throw new HomeProgramError({
        code: 'EXERCISE_NOT_FOUND',
        message_en: 'Exercise not found.',
        message_ar: 'لم يتم العثور على التمرين.',
      });
    }
    if (!exercise.active || exercise.replacedById) {
      throw new HomeProgramError(exerciseArchived);
    }

    const row = await db.homeProgramItem.create({
      data: {
        patientId: input.patientId,
        exerciseId: input.exerciseId,
        daysOfWeek: [...input.daysOfWeek].sort((a, b) => a - b),
        scheduledTime: input.scheduledTime,
        durationMinutes: input.durationMinutes,
        setsReps: input.setsReps ?? null,
        therapistNote: input.therapistNote ?? null,
        active: true,
      },
      select: { id: true },
    });

    // Register the BullMQ recurring reminder. Best-effort: a Redis hiccup
    // logs + continues; the row already exists and the daily check job
    // will surface the missing reminder via the compliance signal.
    try {
      const key = await registerHomeReminderJob({
        itemId: row.id,
        scheduledTime: input.scheduledTime,
        daysOfWeek: [...input.daysOfWeek].sort((a, b) => a - b),
        offsetMinutes: env.HOME_REMINDER_OFFSET_MINUTES,
      });
      if (key) {
        await db.homeProgramItem.update({
          where: { id: row.id },
          data: { reminderJobKey: key },
        });
      }
    } catch (err) {
      console.error('[home-program] reminder registration failed', err);
    }

    return { itemId: row.id };
  },
);

export const updateHomeProgramItem = withAudit<
  [HomeProgramItemUpdateInput, { actorId: string }],
  { itemId: string }
>(
  {
    entityType: 'HomeProgramItem',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'UPDATED' }) as Prisma.InputJsonValue,
  },
  async function inner(input, ctx): Promise<{ itemId: string }> {
    const existing = await db.homeProgramItem.findUnique({
      where: { id: input.id },
      select: { id: true, patientId: true, reminderJobKey: true },
    });
    if (!existing) throw new HomeProgramError(notFound);
    await ensureClinicalActorCanManage({ actorId: ctx.actorId, patientId: existing.patientId });

    await db.homeProgramItem.update({
      where: { id: input.id },
      data: {
        exerciseId: input.exerciseId,
        daysOfWeek: [...input.daysOfWeek].sort((a, b) => a - b),
        scheduledTime: input.scheduledTime,
        durationMinutes: input.durationMinutes,
        setsReps: input.setsReps ?? null,
        therapistNote: input.therapistNote ?? null,
        active: input.active,
      },
    });

    // Re-register the reminder cron to reflect the new schedule.
    try {
      await removeHomeReminderJob(existing.reminderJobKey);
      let newKey: string | null = null;
      if (input.active) {
        newKey = await registerHomeReminderJob({
          itemId: input.id,
          scheduledTime: input.scheduledTime,
          daysOfWeek: [...input.daysOfWeek].sort((a, b) => a - b),
          offsetMinutes: env.HOME_REMINDER_OFFSET_MINUTES,
        });
      }
      await db.homeProgramItem.update({
        where: { id: input.id },
        data: { reminderJobKey: newKey },
      });
    } catch (err) {
      console.error('[home-program] reminder re-registration failed', err);
    }

    return { itemId: input.id };
  },
);

export const setHomeProgramItemActive = withAudit<
  [{ id: string; active: boolean }, { actorId: string }],
  { itemId: string; active: boolean }
>(
  {
    entityType: 'HomeProgramItem',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: (result) =>
      ({ event: result.active ? 'RESUMED' : 'PAUSED' }) as Prisma.InputJsonValue,
  },
  async function inner({ id, active }, ctx): Promise<{ itemId: string; active: boolean }> {
    const existing = await db.homeProgramItem.findUnique({
      where: { id },
      select: {
        patientId: true,
        reminderJobKey: true,
        scheduledTime: true,
        daysOfWeek: true,
      },
    });
    if (!existing) throw new HomeProgramError(notFound);
    await ensureClinicalActorCanManage({ actorId: ctx.actorId, patientId: existing.patientId });
    await db.homeProgramItem.update({ where: { id }, data: { active } });
    // Pause = drop the cron; resume = re-register with the existing schedule.
    try {
      if (!active) {
        await removeHomeReminderJob(existing.reminderJobKey);
        await db.homeProgramItem.update({ where: { id }, data: { reminderJobKey: null } });
      } else if (!existing.reminderJobKey) {
        const key = await registerHomeReminderJob({
          itemId: id,
          scheduledTime: existing.scheduledTime,
          daysOfWeek: existing.daysOfWeek,
          offsetMinutes: env.HOME_REMINDER_OFFSET_MINUTES,
        });
        await db.homeProgramItem.update({ where: { id }, data: { reminderJobKey: key } });
      }
    } catch (err) {
      console.error('[home-program] setActive cron sync failed', err);
    }
    return { itemId: id, active };
  },
);

export const deleteHomeProgramItem = withAudit<
  [{ id: string }, { actorId: string }],
  { itemId: string }
>(
  {
    entityType: 'HomeProgramItem',
    action: AuditAction.DELETE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'DELETED' }) as Prisma.InputJsonValue,
  },
  async function inner({ id }, ctx): Promise<{ itemId: string }> {
    const existing = await db.homeProgramItem.findUnique({
      where: { id },
      select: { patientId: true, reminderJobKey: true },
    });
    if (!existing) throw new HomeProgramError(notFound);
    await ensureClinicalActorCanManage({ actorId: ctx.actorId, patientId: existing.patientId });
    // Remove the BullMQ reminder before deleting the row so the cron
    // doesn't fire against an orphaned id.
    try {
      await removeHomeReminderJob(existing.reminderJobKey);
    } catch (err) {
      console.error('[home-program] reminder removal on delete failed', err);
    }
    // Cascade deletes the HomeProgramCompletion rows (FK Cascade).
    await db.homeProgramItem.delete({ where: { id } });
    return { itemId: id };
  },
);

/**
 * Patient marks today's occurrence done. Idempotent — the unique
 * constraint on (itemId, scheduledDate) means re-submitting is a no-op.
 */
export const markHomeExerciseDone = withAudit<
  [MarkCompleteInput, { patientId: string }],
  { completionId: string }
>(
  {
    entityType: 'HomeProgramCompletion',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.completionId,
    extractAfter: () => ({ event: 'COMPLETED' }) as Prisma.InputJsonValue,
  },
  async function inner(input, ctx): Promise<{ completionId: string }> {
    const item = await db.homeProgramItem.findUnique({
      where: { id: input.itemId },
      select: { id: true, patientId: true, daysOfWeek: true, active: true },
    });
    if (!item || item.patientId !== ctx.patientId) throw new HomeProgramError(notFound);
    if (!item.active) throw new HomeProgramError(forbidden);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dow = today.getUTCDay();
    if (!item.daysOfWeek.includes(dow)) throw new HomeProgramError(notScheduledToday);

    // Idempotent upsert keyed on (itemId, scheduledDate).
    const row = await db.homeProgramCompletion.upsert({
      where: { itemId_scheduledDate: { itemId: item.id, scheduledDate: today } },
      update: {
        // Update completedAt + painScore only if not already completed.
        completedAt: new Date(),
        painScore: input.painScore ?? null,
      },
      create: {
        itemId: item.id,
        scheduledDate: today,
        completedAt: new Date(),
        painScore: input.painScore ?? null,
      },
      select: { id: true },
    });
    return { completionId: row.id };
  },
);

export function homeProgramToLocalized(err: unknown): LocalizedError {
  if (err instanceof HomeProgramError) return err.error;
  return toLocalizedError(err);
}

export async function currentClinicianId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new HomeProgramError(unauthenticated);
  if (
    session.user.role !== UserRole.DOCTOR &&
    session.user.role !== UserRole.THERAPIST &&
    session.user.role !== UserRole.ADMIN
  ) {
    throw new HomeProgramError(forbidden);
  }
  return session.user.id;
}

export async function currentPatientId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new HomeProgramError(unauthenticated);
  if (session.user.role !== UserRole.PATIENT) {
    throw new HomeProgramError(forbidden);
  }
  return session.user.id;
}
