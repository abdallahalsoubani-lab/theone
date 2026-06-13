'use server';

import { revalidatePath } from 'next/cache';

import { fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import { customFieldCreateSchema, customFieldIdSchema, customFieldUpdateSchema } from './schemas';
import {
  createCustomField,
  deactivateCustomField,
  pedToLocalized,
  updateCustomField,
} from './services';

function revalidate(): void {
  revalidatePath('/[locale]/(staff)/doctor/pediatric-fields', 'page');
}

export async function createCustomFieldAction(input: unknown): Promise<Result<{ id: string }>> {
  await requirePermission('pediatric_assessment.manage_fields');
  const parsed = customFieldCreateSchema.safeParse(input);
  if (!parsed.success) return fail(pedToLocalized(parsed.error));
  try {
    const data = await createCustomField(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(pedToLocalized(err));
  }
}

export async function updateCustomFieldAction(input: unknown): Promise<Result<{ id: string }>> {
  await requirePermission('pediatric_assessment.manage_fields');
  const parsed = customFieldUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(pedToLocalized(parsed.error));
  try {
    const data = await updateCustomField(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(pedToLocalized(err));
  }
}

export async function deactivateCustomFieldAction(input: unknown): Promise<Result<{ id: string }>> {
  await requirePermission('pediatric_assessment.manage_fields');
  const parsed = customFieldIdSchema.safeParse(input);
  if (!parsed.success) return fail(pedToLocalized(parsed.error));
  try {
    const data = await deactivateCustomField(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(pedToLocalized(err));
  }
}
