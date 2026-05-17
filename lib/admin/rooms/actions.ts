'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/rbac/guards';
import { fail, ok, type Result } from '@/lib/auth/result';

import { createRoom, deactivateRoom, deleteRoom, roomToLocalized, updateRoom } from './services';
import {
  roomCreateSchema,
  roomUpdateSchema,
  type RoomCreateInput,
  type RoomUpdateInput,
} from './schemas';

const revalidate = () => revalidatePath('/[locale]/(admin)/admin/rooms', 'page');

export async function createRoomAction(input: RoomCreateInput): Promise<Result<{ id: string }>> {
  await requirePermission('rooms.create');
  const parsed = roomCreateSchema.safeParse(input);
  if (!parsed.success) return fail(roomToLocalized(parsed.error));
  try {
    const data = await createRoom(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(roomToLocalized(err));
  }
}

export async function updateRoomAction(input: RoomUpdateInput): Promise<Result<{ id: string }>> {
  await requirePermission('rooms.update');
  const parsed = roomUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(roomToLocalized(parsed.error));
  try {
    const data = await updateRoom(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(roomToLocalized(err));
  }
}

export async function deactivateRoomAction(id: string): Promise<Result<{ id: string }>> {
  await requirePermission('rooms.archive');
  try {
    const data = await deactivateRoom(id);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(roomToLocalized(err));
  }
}

export async function deleteRoomAction(id: string): Promise<Result<{ id: string }>> {
  await requirePermission('rooms.delete');
  try {
    const data = await deleteRoom(id);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(roomToLocalized(err));
  }
}
