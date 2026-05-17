'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/rbac/guards';
import { fail, ok, type Result } from '@/lib/auth/result';

import {
  createSpecialty,
  deactivateSpecialty,
  deleteSpecialty,
  specialtyToLocalized,
  updateSpecialty,
} from './services';
import {
  specialtyCreateSchema,
  specialtyUpdateSchema,
  type SpecialtyCreateInput,
  type SpecialtyUpdateInput,
} from './schemas';

const revalidate = () => revalidatePath('/[locale]/(admin)/admin/specialties', 'page');

export async function createSpecialtyAction(
  input: SpecialtyCreateInput,
): Promise<Result<{ id: string }>> {
  await requirePermission('users.update'); // admin-only — same gate as user mutations
  const parsed = specialtyCreateSchema.safeParse(input);
  if (!parsed.success) return fail(specialtyToLocalized(parsed.error));
  try {
    const data = await createSpecialty(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(specialtyToLocalized(err));
  }
}

export async function updateSpecialtyAction(
  input: SpecialtyUpdateInput,
): Promise<Result<{ id: string }>> {
  await requirePermission('users.update');
  const parsed = specialtyUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(specialtyToLocalized(parsed.error));
  try {
    const data = await updateSpecialty(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(specialtyToLocalized(err));
  }
}

export async function deactivateSpecialtyAction(id: string): Promise<Result<{ id: string }>> {
  await requirePermission('users.update');
  try {
    const data = await deactivateSpecialty(id);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(specialtyToLocalized(err));
  }
}

export async function deleteSpecialtyAction(id: string): Promise<Result<{ id: string }>> {
  await requirePermission('users.delete');
  try {
    const data = await deleteSpecialty(id);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(specialtyToLocalized(err));
  }
}
