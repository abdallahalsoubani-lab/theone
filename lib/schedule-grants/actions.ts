'use server';

import { revalidatePath } from 'next/cache';

import { fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import { grantCreateSchema, grantDeleteSchema } from './schemas';
import {
  GRANT_ERRORS,
  createScheduleGrant,
  deleteScheduleGrant,
  grantToLocalized,
} from './services';

const revalidate = () => {
  revalidatePath('/[locale]/(admin)/admin/schedule-access', 'page');
  revalidatePath('/[locale]/(staff)/secretary/schedule-access', 'page');
  revalidatePath('/[locale]/(staff)/therapist/calendar', 'page');
};

export async function createScheduleGrantAction(input: unknown): Promise<Result<{ id: string }>> {
  await requirePermission('schedule_grants.manage');
  const parsed = grantCreateSchema.safeParse(input);
  if (!parsed.success) {
    const self = parsed.error.issues.some((i) => i.message === 'self');
    return fail(self ? GRANT_ERRORS.SELF : grantToLocalized(parsed.error));
  }
  try {
    const r = await createScheduleGrant(parsed.data);
    revalidate();
    return ok({ id: r.id });
  } catch (err) {
    return fail(grantToLocalized(err));
  }
}

export async function deleteScheduleGrantAction(input: unknown): Promise<Result<{ id: string }>> {
  await requirePermission('schedule_grants.manage');
  const parsed = grantDeleteSchema.safeParse(input);
  if (!parsed.success) return fail(grantToLocalized(parsed.error));
  try {
    const r = await deleteScheduleGrant(parsed.data);
    revalidate();
    return ok(r);
  } catch (err) {
    return fail(grantToLocalized(err));
  }
}
