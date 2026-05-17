'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/rbac/guards';
import { fail, ok, type Result } from '@/lib/auth/result';

import {
  createCustomQuestion,
  customQuestionToLocalized,
  deactivateCustomQuestion,
  deleteCustomQuestion,
  reorderCustomQuestions,
  updateCustomQuestion,
} from './services';
import {
  customQuestionCreateSchema,
  customQuestionReorderSchema,
  customQuestionUpdateSchema,
  type CustomQuestionCreateInput,
  type CustomQuestionReorderInput,
  type CustomQuestionUpdateInput,
} from './schemas';

const revalidate = () => revalidatePath('/[locale]/(admin)/admin/intake-questions', 'page');

export async function createCustomQuestionAction(
  input: CustomQuestionCreateInput,
): Promise<Result<{ id: string }>> {
  await requirePermission('users.update');
  const parsed = customQuestionCreateSchema.safeParse(input);
  if (!parsed.success) return fail(customQuestionToLocalized(parsed.error));
  try {
    const data = await createCustomQuestion(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(customQuestionToLocalized(err));
  }
}

export async function updateCustomQuestionAction(
  input: CustomQuestionUpdateInput,
): Promise<Result<{ id: string }>> {
  await requirePermission('users.update');
  const parsed = customQuestionUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(customQuestionToLocalized(parsed.error));
  try {
    const data = await updateCustomQuestion(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(customQuestionToLocalized(err));
  }
}

export async function reorderCustomQuestionsAction(
  input: CustomQuestionReorderInput,
): Promise<Result<{ count: number }>> {
  await requirePermission('users.update');
  const parsed = customQuestionReorderSchema.safeParse(input);
  if (!parsed.success) return fail(customQuestionToLocalized(parsed.error));
  try {
    const data = await reorderCustomQuestions(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(customQuestionToLocalized(err));
  }
}

export async function deactivateCustomQuestionAction(id: string): Promise<Result<{ id: string }>> {
  await requirePermission('users.update');
  try {
    const data = await deactivateCustomQuestion(id);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(customQuestionToLocalized(err));
  }
}

export async function deleteCustomQuestionAction(id: string): Promise<Result<{ id: string }>> {
  await requirePermission('users.delete');
  try {
    const data = await deleteCustomQuestion(id);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(customQuestionToLocalized(err));
  }
}
