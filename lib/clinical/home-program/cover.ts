import { AuditAction } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';

import { ensureClinicalActorCanManage } from './services';

/**
 * P64 #15 — the home-program PDF cover, per patient: what the program helps
 * with (one goal per line) + a note for the parents / patient. Written by
 * the care-team therapist or a doctor; independent of the program approval
 * state (it is print copy, not a schedule change).
 */
export const homeProgramCoverSchema = z.object({
  patientId: z.string().min(1),
  goals: z.string().max(3000),
  parentNotes: z.string().max(3000),
});
export type HomeProgramCoverInput = z.infer<typeof homeProgramCoverSchema>;

export interface HomeProgramCoverRow {
  goals: string;
  parentNotes: string;
}

export async function getHomeProgramCover(patientId: string): Promise<HomeProgramCoverRow> {
  const row = await db.homeProgramCover.findUnique({
    where: { patientId },
    select: { goals: true, parentNotes: true },
  });
  return row ?? { goals: '', parentNotes: '' };
}

export const saveHomeProgramCover = withAudit<
  [HomeProgramCoverInput, { actorId: string }],
  { patientId: string }
>(
  {
    entityType: 'HomeProgramCover',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].patientId,
    extractBefore: async (args) =>
      db.homeProgramCover.findUnique({
        where: { patientId: args[0].patientId },
        select: { goals: true, parentNotes: true },
      }),
    extractAfter: () => ({ event: 'HOME_PROGRAM_COVER_SAVED' }) as Prisma.InputJsonValue,
  },
  async function saveCoverInner(input, ctx): Promise<{ patientId: string }> {
    await ensureClinicalActorCanManage({ actorId: ctx.actorId, patientId: input.patientId });
    const data = {
      goals: input.goals.trim(),
      parentNotes: input.parentNotes.trim(),
      updatedById: ctx.actorId,
    };
    await db.homeProgramCover.upsert({
      where: { patientId: input.patientId },
      create: { patientId: input.patientId, ...data },
      update: data,
    });
    return { patientId: input.patientId };
  },
);

/** The patient's uploaded image documents — attachable as exercise photos. */
export async function listPatientPhotos(
  patientId: string,
): Promise<Array<{ id: string; fileName: string }>> {
  return db.patientDocument.findMany({
    where: { patientId, status: 'READY', active: true, mimeType: { startsWith: 'image/' } },
    select: { id: true, fileName: true },
    orderBy: { createdAt: 'desc' },
  });
}
