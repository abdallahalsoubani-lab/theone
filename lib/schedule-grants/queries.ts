import { db } from '@/lib/db';

/**
 * P64 #4 — read side of the per-pair schedule grants. `grantedOwnerIds` is
 * the ONE place the therapist calendar asks "whose schedules may I see?".
 * Soft-deleted users drop out on both ends.
 */
export async function grantedOwnerIds(viewerId: string): Promise<string[]> {
  const rows = await db.scheduleViewGrant.findMany({
    where: { viewerId, owner: { deletedAt: null } },
    select: { ownerId: true },
  });
  return rows.map((r) => r.ownerId);
}

export interface ScheduleGrantRow {
  id: string;
  createdAt: Date;
  viewer: { id: string; fullNameEn: string; fullNameAr: string };
  owner: { id: string; fullNameEn: string; fullNameAr: string };
}

export async function listScheduleGrants(): Promise<ScheduleGrantRow[]> {
  const person = { select: { id: true, fullNameEn: true, fullNameAr: true } } as const;
  return db.scheduleViewGrant.findMany({
    where: { viewer: { deletedAt: null }, owner: { deletedAt: null } },
    select: { id: true, createdAt: true, viewer: person, owner: person },
    orderBy: [{ viewer: { fullNameEn: 'asc' } }, { owner: { fullNameEn: 'asc' } }],
  });
}
