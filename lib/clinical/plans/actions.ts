'use server';

import { revalidatePath } from 'next/cache';

import type { Result } from '@/lib/auth/result';
import type { LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { planCreateSchema, planProposeSchema, planRejectSchema } from './schemas';
import {
  approveProposal,
  completeTreatmentPlan,
  createTreatmentPlan,
  currentDoctorId,
  currentTherapistId,
  discontinueTreatmentPlan,
  pauseTreatmentPlan,
  planToLocalized,
  proposeTreatmentPlanChange,
  rejectProposal,
} from './services';

/**
 * 'use server' facade for the clinical-plans services.
 *
 * Pattern mirrors lib/appointments/actions.ts: validate via Zod, run a
 * permission gate, invoke the service, return Result<T, LocalizedError>.
 * Pages call these actions; the service layer never reaches the client.
 */

export async function createTreatmentPlanAction(
  raw: unknown,
): Promise<Result<{ planId: string }, LocalizedError>> {
  await requirePermission('treatment_plans.create');
  const parsed = planCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: parsed.error.issues[0]?.message ?? 'Invalid plan input.',
        message_ar: 'بيانات الخطة غير صالحة.',
      },
    };
  }
  try {
    const doctorId = await currentDoctorId();
    const data = await createTreatmentPlan(parsed.data, { doctorId });
    revalidatePath('/doctor/dashboard');
    revalidatePath(`/secretary/patients/${parsed.data.patientId}`);
    revalidatePath(`/doctor/patients/${parsed.data.patientId}`);
    revalidatePath(`/therapist/patients/${parsed.data.patientId}`);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: planToLocalized(err) };
  }
}

export async function proposeTreatmentPlanChangeAction(
  raw: unknown,
): Promise<Result<{ planId: string }, LocalizedError>> {
  await requirePermission('treatment_plans.propose');
  const parsed = planProposeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: parsed.error.issues[0]?.message ?? 'Invalid proposal input.',
        message_ar: 'بيانات الاقتراح غير صالحة.',
      },
    };
  }
  try {
    const therapistId = await currentTherapistId();
    const data = await proposeTreatmentPlanChange(parsed.data, { therapistId });
    revalidatePath('/doctor/dashboard');
    revalidatePath(`/therapist/patients/${parsed.data.patientId}`);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: planToLocalized(err) };
  }
}

export async function approveProposalAction(
  proposedPlanId: string,
): Promise<Result<{ activePlanId: string }, LocalizedError>> {
  await requirePermission('treatment_plans.approve');
  try {
    const doctorId = await currentDoctorId();
    const data = await approveProposal({ proposedPlanId }, { doctorId });
    revalidatePath('/doctor/dashboard');
    revalidatePath('/therapist/dashboard');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: planToLocalized(err) };
  }
}

export async function rejectProposalAction(
  raw: unknown,
): Promise<Result<{ planId: string }, LocalizedError>> {
  await requirePermission('treatment_plans.reject');
  const parsed = planRejectSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: parsed.error.issues[0]?.message ?? 'A rejection reason is required.',
        message_ar: 'سبب الرفض مطلوب.',
      },
    };
  }
  try {
    const doctorId = await currentDoctorId();
    const data = await rejectProposal(parsed.data, { doctorId });
    revalidatePath('/doctor/dashboard');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: planToLocalized(err) };
  }
}

export async function pausePlanAction(
  planId: string,
): Promise<Result<{ planId: string }, LocalizedError>> {
  await requirePermission('treatment_plans.pause');
  try {
    const doctorId = await currentDoctorId();
    const data = await pauseTreatmentPlan({ planId }, { doctorId });
    revalidatePath('/doctor/dashboard');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: planToLocalized(err) };
  }
}

export async function completePlanAction(
  planId: string,
): Promise<Result<{ planId: string }, LocalizedError>> {
  await requirePermission('treatment_plans.complete');
  try {
    const doctorId = await currentDoctorId();
    const data = await completeTreatmentPlan({ planId }, { doctorId });
    revalidatePath('/doctor/dashboard');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: planToLocalized(err) };
  }
}

export async function discontinuePlanAction(
  planId: string,
): Promise<Result<{ planId: string }, LocalizedError>> {
  await requirePermission('treatment_plans.discontinue');
  try {
    const doctorId = await currentDoctorId();
    const data = await discontinueTreatmentPlan({ planId }, { doctorId });
    revalidatePath('/doctor/dashboard');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: planToLocalized(err) };
  }
}
