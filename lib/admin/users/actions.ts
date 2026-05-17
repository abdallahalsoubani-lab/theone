'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/rbac/guards';
import { fail, ok, type Result } from '@/lib/auth/result';

import {
  adminToLocalized,
  archiveUser,
  createUser,
  forceResetPassword,
  restoreUser,
  updateUser,
} from './services';
import {
  userCreateSchema,
  userUpdateSchema,
  type UserCreateInput,
  type UserUpdateInput,
} from './schemas';

const revalidate = () => {
  revalidatePath('/[locale]/(admin)/admin/users', 'page');
};

export async function createUserAction(
  input: UserCreateInput,
): Promise<Result<{ userId: string; tempPassword: string }>> {
  await requirePermission('users.create');
  const parsed = userCreateSchema.safeParse(input);
  if (!parsed.success) return fail(adminToLocalized(parsed.error));
  try {
    const data = await createUser(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(adminToLocalized(err));
  }
}

export async function updateUserAction(
  input: UserUpdateInput,
): Promise<Result<{ userId: string }>> {
  await requirePermission('users.update');
  const parsed = userUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(adminToLocalized(parsed.error));
  try {
    const data = await updateUser(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(adminToLocalized(err));
  }
}

export async function archiveUserAction(id: string): Promise<Result<{ userId: string }>> {
  await requirePermission('users.delete');
  try {
    const data = await archiveUser(id);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(adminToLocalized(err));
  }
}

export async function restoreUserAction(id: string): Promise<Result<{ userId: string }>> {
  await requirePermission('users.update');
  try {
    const data = await restoreUser(id);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(adminToLocalized(err));
  }
}

export async function forceResetPasswordAction(
  id: string,
): Promise<Result<{ userId: string; tempPassword: string }>> {
  await requirePermission('users.update');
  try {
    const data = await forceResetPassword(id);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(adminToLocalized(err));
  }
}
