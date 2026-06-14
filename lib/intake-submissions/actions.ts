'use server';

import { revalidatePath } from 'next/cache';

import { fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import { submissionToLocalized } from './errors';
import { approveLinkSchema, approveNewSchema, rejectSubmissionSchema } from './schemas';
import { approveSubmissionLink, approveSubmissionNew, rejectSubmission } from './services';

function revalidate(): void {
  revalidatePath('/[locale]/(staff)/secretary/intake-submissions', 'page');
  revalidatePath('/[locale]/(staff)/secretary/intake-submissions/[id]', 'page');
}

/** Approve → create a new patient. SECRETARY + ADMIN only. */
export async function approveSubmissionNewAction(
  input: unknown,
): Promise<Result<{ patientId: string }>> {
  await requirePermission('intake_submission.review');
  // Patient creation also routes through its own permission + audited service.
  await requirePermission('patients.create');
  const parsed = approveNewSchema.safeParse(input);
  if (!parsed.success) return fail(submissionToLocalized(parsed.error));
  try {
    const result = await approveSubmissionNew({ submissionId: parsed.data.submissionId });
    revalidate();
    return ok({ patientId: result.patientId });
  } catch (err) {
    return fail(submissionToLocalized(err));
  }
}

/** Approve → link to an existing patient (duplicate phone). */
export async function approveSubmissionLinkAction(
  input: unknown,
): Promise<Result<{ patientId: string }>> {
  await requirePermission('intake_submission.review');
  const parsed = approveLinkSchema.safeParse(input);
  if (!parsed.success) return fail(submissionToLocalized(parsed.error));
  try {
    const result = await approveSubmissionLink({
      submissionId: parsed.data.submissionId,
      patientId: parsed.data.patientId,
    });
    revalidate();
    return ok({ patientId: result.patientId });
  } catch (err) {
    return fail(submissionToLocalized(err));
  }
}

/** Reject → no patient created. */
export async function rejectSubmissionAction(
  input: unknown,
): Promise<Result<{ submissionId: string }>> {
  await requirePermission('intake_submission.review');
  const parsed = rejectSubmissionSchema.safeParse(input);
  if (!parsed.success) return fail(submissionToLocalized(parsed.error));
  try {
    const result = await rejectSubmission({
      submissionId: parsed.data.submissionId,
      reason: parsed.data.reason || undefined,
    });
    revalidate();
    return ok({ submissionId: result.submissionId });
  } catch (err) {
    return fail(submissionToLocalized(err));
  }
}
