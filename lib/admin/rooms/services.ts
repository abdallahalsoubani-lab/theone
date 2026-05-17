import { AuditAction } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';

import type { RoomCreateInput, RoomUpdateInput } from './schemas';

export class RoomAdminError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'RoomAdminError';
  }
}

const duplicateName: LocalizedError = {
  code: 'ROOM_DUPLICATE',
  message_en: 'A room with this name already exists.',
  message_ar: 'يوجد غرفة بهذا الاسم.',
};

const inUse = (count: number): LocalizedError => ({
  code: 'ROOM_IN_USE',
  message_en: `Cannot delete: ${count} appointment(s) reference this room. Deactivate instead.`,
  message_ar: `لا يمكن الحذف: ${count} موعد/مواعيد مرتبطة. يمكن التعطيل بدلاً من ذلك.`,
  details: { count },
});

async function ensureUniqueName(name: string, excludeId?: string): Promise<void> {
  const existing = await db.room.findFirst({
    where: { name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (existing) throw new RoomAdminError(duplicateName);
}

export const createRoom = withAudit<[RoomCreateInput], { id: string }>(
  {
    entityType: 'Room',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.id,
    extractAfter: (result) => result,
  },
  async function createRoomInner(input): Promise<{ id: string }> {
    await ensureUniqueName(input.name);
    const row = await db.room.create({
      data: { name: input.name, active: input.active },
    });
    return { id: row.id };
  },
);

export const updateRoom = withAudit<[RoomUpdateInput], { id: string }>(
  {
    entityType: 'Room',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) => db.room.findUnique({ where: { id: args[0].id } }),
    extractAfter: (result) => result,
  },
  async function updateRoomInner(input): Promise<{ id: string }> {
    await ensureUniqueName(input.name, input.id);
    await db.room.update({
      where: { id: input.id },
      data: { name: input.name, active: input.active },
    });
    return { id: input.id };
  },
);

export const deactivateRoom = withAudit<[string], { id: string }>(
  {
    entityType: 'Room',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: () => ({ event: 'ROOM_DEACTIVATED' }),
  },
  async function deactivateRoomInner(id): Promise<{ id: string }> {
    await db.room.update({ where: { id }, data: { active: false } });
    return { id };
  },
);

export const deleteRoom = withAudit<[string], { id: string }>(
  {
    entityType: 'Room',
    action: AuditAction.DELETE,
    extractEntityId: (args) => args[0],
    extractBefore: async (args) => db.room.findUnique({ where: { id: args[0] } }),
    extractAfter: () => ({ event: 'ROOM_DELETED' }),
  },
  async function deleteRoomInner(id): Promise<{ id: string }> {
    // The Appointment.roomId FK is onDelete: Restrict — Prisma would throw
    // P2003 anyway. Count first so we can surface a friendly message that
    // tells the admin how many appointments are in the way.
    const count = await db.appointment.count({ where: { roomId: id } });
    if (count > 0) throw new RoomAdminError(inUse(count));
    await db.room.delete({ where: { id } });
    return { id };
  },
);

export function roomToLocalized(err: unknown): LocalizedError {
  if (err instanceof RoomAdminError) return err.error;
  return toLocalizedError(err);
}
