'use server';

import { revalidatePath } from 'next/cache';

import { fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import {
  leaveApproveSchema,
  leaveRejectSchema,
  leaveRequestSchema,
  type LeaveApproveInput,
  type LeaveRejectInput,
  type LeaveRequestInput,
} from './schemas';
import { approveLeave, leaveToLocalized, rejectLeave, requestLeave } from './services';

const revalidate = () => {
  revalidatePath('/[locale]/(staff)/staff/leave', 'page');
  revalidatePath('/[locale]/(admin)/admin/leaves', 'page');
};

export async function requestLeaveAction(
  input: LeaveRequestInput,
): Promise<Result<{ leaveId: string; adminCount: number }>> {
  await requirePermission('leaves.create.own');
  const parsed = leaveRequestSchema.safeParse(input);
  if (!parsed.success) return fail(leaveToLocalized(parsed.error));
  try {
    const data = await requestLeave(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(leaveToLocalized(err));
  }
}

export async function approveLeaveAction(
  input: LeaveApproveInput,
): Promise<Result<{ leaveId: string; requesterId: string; conflictCount: number }>> {
  await requirePermission('leaves.update');
  const parsed = leaveApproveSchema.safeParse(input);
  if (!parsed.success) return fail(leaveToLocalized(parsed.error));
  try {
    const data = await approveLeave(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(leaveToLocalized(err));
  }
}

export async function rejectLeaveAction(
  input: LeaveRejectInput,
): Promise<Result<{ leaveId: string; requesterId: string }>> {
  await requirePermission('leaves.update');
  const parsed = leaveRejectSchema.safeParse(input);
  if (!parsed.success) return fail(leaveToLocalized(parsed.error));
  try {
    const data = await rejectLeave(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(leaveToLocalized(err));
  }
}
