'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { AUTH_ERRORS, fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import {
  createPatient,
  patientToLocalized,
  updateOwnPatientProfile,
  updatePatient,
} from './services';
import {
  patientCreateSchema,
  patientSelfEditSchema,
  patientUpdateSchema,
  type PatientCreateInput,
  type PatientSelfEditInput,
  type PatientUpdateInput,
} from './schemas';

const revalidate = () => {
  revalidatePath('/[locale]/(staff)/secretary/patients', 'page');
};

export async function createPatientAction(input: PatientCreateInput): Promise<
  Result<{
    patientId: string;
    tempPassword: string;
    whatsappStatus: 'SENT' | 'FAILED';
  }>
> {
  await requirePermission('patients.create');
  const parsed = patientCreateSchema.safeParse(input);
  if (!parsed.success) return fail(patientToLocalized(parsed.error));
  try {
    const data = await createPatient(parsed.data);
    revalidate();
    return ok({
      patientId: data.patientId,
      tempPassword: data.tempPassword,
      whatsappStatus: data.whatsappStatus,
    });
  } catch (err) {
    return fail(patientToLocalized(err));
  }
}

export async function updatePatientAction(
  input: PatientUpdateInput,
): Promise<Result<{ patientId: string }>> {
  await requirePermission('patients.update');
  const parsed = patientUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(patientToLocalized(parsed.error));
  try {
    const data = await updatePatient(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(patientToLocalized(err));
  }
}

export async function updateOwnProfileAction(
  input: PatientSelfEditInput,
): Promise<Result<{ patientId: string }>> {
  const session = await auth();
  if (!session?.user?.id) return fail(AUTH_ERRORS.UNAUTHENTICATED);
  if (session.user.role !== 'PATIENT') return fail(AUTH_ERRORS.FORBIDDEN);

  const parsed = patientSelfEditSchema.safeParse(input);
  if (!parsed.success) return fail(patientToLocalized(parsed.error));
  try {
    const data = await updateOwnPatientProfile(session.user.id, parsed.data);
    revalidatePath('/[locale]/(patient)/patient/profile', 'page');
    return ok(data);
  } catch (err) {
    return fail(patientToLocalized(err));
  }
}
