'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import { waitlistAddSchema, waitlistFulfillSchema, waitlistRemoveSchema } from './schemas';
import {
  addWaitlistEntry,
  fulfillWaitlistEntry,
  removeWaitlistEntry,
  waitlistToLocalized,
} from './services';

function revalidateWaitlist(): void {
  revalidatePath('/[locale]/(staff)/secretary/waitlist', 'page');
}

export async function addWaitlistEntryAction(input: unknown): Promise<Result<{ id: string }>> {
  await requirePermission('waitlist.create');
  const parsed = waitlistAddSchema.safeParse(input);
  if (!parsed.success) return fail(waitlistToLocalized(parsed.error));

  const session = await auth();
  if (!session?.user?.id) return fail(waitlistToLocalized(new Error('unauthenticated')));

  try {
    const data = await addWaitlistEntry(parsed.data, session.user.id);
    revalidateWaitlist();
    return ok(data);
  } catch (err) {
    return fail(waitlistToLocalized(err));
  }
}

export async function removeWaitlistEntryAction(input: unknown): Promise<Result<{ id: string }>> {
  await requirePermission('waitlist.remove');
  const parsed = waitlistRemoveSchema.safeParse(input);
  if (!parsed.success) return fail(waitlistToLocalized(parsed.error));
  try {
    const data = await removeWaitlistEntry(parsed.data);
    revalidateWaitlist();
    return ok(data);
  } catch (err) {
    return fail(waitlistToLocalized(err));
  }
}

/**
 * Mark an entry FULFILLED after the placement modal booked an appointment.
 * The booking itself runs through the normal createAppointmentAction (conflict
 * checks, WhatsApp confirmation, care-team add, audit) — this only links the
 * entry to that appointment and rejects double-placement.
 */
export async function fulfillWaitlistEntryAction(
  input: unknown,
): Promise<Result<{ id: string; appointmentId: string }>> {
  await requirePermission('waitlist.place');
  const parsed = waitlistFulfillSchema.safeParse(input);
  if (!parsed.success) return fail(waitlistToLocalized(parsed.error));

  const session = await auth();
  if (!session?.user?.id) return fail(waitlistToLocalized(new Error('unauthenticated')));

  try {
    const data = await fulfillWaitlistEntry(parsed.data, session.user.id);
    revalidateWaitlist();
    return ok(data);
  } catch (err) {
    return fail(waitlistToLocalized(err));
  }
}
