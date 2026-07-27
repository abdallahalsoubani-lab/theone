'use server';

import { revalidatePath } from 'next/cache';

import { fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import {
  leaveAddSchema,
  leaveApproveSchema,
  leaveDeleteSchema,
  leaveRejectSchema,
  leaveRequestSchema,
  type LeaveAddInput,
  type LeaveApproveInput,
  type LeaveDeleteInput,
  type LeaveRejectInput,
  type LeaveRequestInput,
} from './schemas';
import {
  approveLeave,
  createLeaveForUser,
  deleteLeave,
  leaveToLocalized,
  rejectLeave,
  requestLeave,
} from './services';

const revalidate = () => {
  revalidatePath('/[locale]/(staff)/staff/leave', 'page');
  revalidatePath('/[locale]/(admin)/admin/leaves', 'page');
  // Prompt 55 §1 — leaves now surface on more pages: the shared management
  // board, the users table (row-menu dialog), and every calendar view that
  // renders the gray leave columns.
  revalidatePath('/[locale]/(staff)/secretary/leaves', 'page');
  revalidatePath('/[locale]/(admin)/admin/users', 'page');
  revalidatePath('/[locale]/(staff)/secretary/calendar', 'page');
  revalidatePath('/[locale]/(admin)/admin/calendar', 'page');
  revalidatePath('/[locale]/(staff)/doctor/calendar', 'page');
  revalidatePath('/[locale]/(staff)/therapist/calendar', 'page');
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

export async function addLeaveForUserAction(
  input: LeaveAddInput,
): Promise<Result<{ leaveId: string; conflictCount: number }>> {
  await requirePermission('leaves.create');
  const parsed = leaveAddSchema.safeParse(input);
  if (!parsed.success) return fail(leaveToLocalized(parsed.error));
  try {
    const data = await createLeaveForUser(parsed.data);
    revalidate();
    return ok({ leaveId: data.leaveId, conflictCount: data.conflictCount });
  } catch (err) {
    return fail(leaveToLocalized(err));
  }
}

export async function deleteLeaveAction(
  input: LeaveDeleteInput,
): Promise<Result<{ leaveId: string }>> {
  await requirePermission('leaves.delete');
  const parsed = leaveDeleteSchema.safeParse(input);
  if (!parsed.success) return fail(leaveToLocalized(parsed.error));
  try {
    const data = await deleteLeave(parsed.data);
    revalidate();
    return ok({ leaveId: data.leaveId });
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
