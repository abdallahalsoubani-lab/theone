import 'server-only';

import { db } from '@/lib/db';

export interface HomeProgramItemRow {
  id: string;
  patientId: string;
  exerciseId: string;
  exerciseNameEn: string;
  exerciseNameAr: string;
  exerciseVideoUrl: string | null;
  exerciseImageUrl: string | null;
  exerciseDescriptionEn: string;
  exerciseDescriptionAr: string;
  exerciseDefaultInstructionEn: string | null;
  exerciseDefaultInstructionAr: string | null;
  /** Version of the exercise this item references, and whether a newer one
   *  has replaced it — so every surface can say WHICH version the patient was
   *  actually given (PT-B5 item 2). Optional: rows revived from an approval
   *  snapshot taken before this existed simply render the clean name. */
  exerciseVersion?: number;
  exerciseSuperseded?: boolean;
  daysOfWeek: number[];
  scheduledTime: string;
  durationMinutes: number;
  setsReps: string | null;
  therapistNote: string | null;
  active: boolean;
  reminderJobKey: string | null;
  createdAt: Date;
}

function shape(row: NonNullable<Awaited<ReturnType<typeof loadItem>>>): HomeProgramItemRow {
  return {
    id: row.id,
    patientId: row.patientId,
    exerciseId: row.exerciseId,
    exerciseNameEn: row.exercise.nameEn,
    exerciseNameAr: row.exercise.nameAr,
    exerciseVideoUrl: row.exercise.videoUrl,
    exerciseImageUrl: row.exercise.imageUrl,
    exerciseDescriptionEn: row.exercise.descriptionEn,
    exerciseDescriptionAr: row.exercise.descriptionAr,
    exerciseDefaultInstructionEn: row.exercise.defaultInstructionEn,
    exerciseDefaultInstructionAr: row.exercise.defaultInstructionAr,
    exerciseVersion: row.exercise.version,
    exerciseSuperseded: row.exercise.replacedById !== null,
    daysOfWeek: row.daysOfWeek,
    scheduledTime: row.scheduledTime,
    durationMinutes: row.durationMinutes,
    setsReps: row.setsReps,
    therapistNote: row.therapistNote,
    active: row.active,
    reminderJobKey: row.reminderJobKey,
    createdAt: row.createdAt,
  };
}

async function loadItem(id: string) {
  return db.homeProgramItem.findUnique({
    where: { id },
    include: {
      exercise: {
        select: {
          nameEn: true,
          nameAr: true,
          videoUrl: true,
          imageUrl: true,
          descriptionEn: true,
          descriptionAr: true,
          defaultInstructionEn: true,
          defaultInstructionAr: true,
          version: true,
          replacedById: true,
        },
      },
    },
  });
}

export async function getHomeProgramItem(id: string): Promise<HomeProgramItemRow | null> {
  const row = await loadItem(id);
  return row ? shape(row) : null;
}

export async function listHomeProgramForPatient(patientId: string): Promise<HomeProgramItemRow[]> {
  const rows = await db.homeProgramItem.findMany({
    where: { patientId },
    orderBy: [{ active: 'desc' }, { scheduledTime: 'asc' }, { createdAt: 'asc' }],
    include: {
      exercise: {
        select: {
          nameEn: true,
          nameAr: true,
          videoUrl: true,
          imageUrl: true,
          descriptionEn: true,
          descriptionAr: true,
          defaultInstructionEn: true,
          defaultInstructionAr: true,
          version: true,
          replacedById: true,
        },
      },
    },
  });
  return rows.map(shape);
}

/**
 * Today's items for a patient — used by the patient portal's "Today"
 * tab. Filter by daysOfWeek matching the current weekday + active=true.
 */
export async function listTodayItemsForPatient(
  patientId: string,
  now: Date = new Date(),
): Promise<HomeProgramItemRow[]> {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const dow = today.getUTCDay();
  const items = await listHomeProgramForPatient(patientId);
  return items.filter((i) => i.active && i.daysOfWeek.includes(dow));
}

/**
 * Completion lookup for a patient's items in a date range. Returns
 * a map of itemId → set of YYYY-MM-DD strings for cheap lookup.
 */
export async function getCompletionsForPatient(args: {
  patientId: string;
  from: Date;
  to: Date;
}): Promise<Map<string, Set<string>>> {
  const rows = await db.homeProgramCompletion.findMany({
    where: {
      item: { patientId: args.patientId },
      scheduledDate: { gte: args.from, lte: args.to },
    },
    select: { itemId: true, scheduledDate: true },
  });
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = r.scheduledDate.toISOString().slice(0, 10);
    if (!map.has(r.itemId)) map.set(r.itemId, new Set());
    map.get(r.itemId)!.add(key);
  }
  return map;
}
