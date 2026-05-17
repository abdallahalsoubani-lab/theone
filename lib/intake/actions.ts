'use server';

import { revalidatePath } from 'next/cache';

import { fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import {
  adultIntakeSchema,
  pediatricIntakeSchema,
  type AdultIntakeInput,
  type PediatricIntakeInput,
} from './schemas';
import { createAdultIntake, createPediatricIntake, intakeToLocalized } from './services';

export async function createAdultIntakeAction(input: {
  patientId: string;
  data: AdultIntakeInput;
}): Promise<Result<{ intakeId: string; patientId: string }>> {
  await requirePermission('intake.create');
  const parsed = adultIntakeSchema.safeParse(input.data);
  if (!parsed.success) return fail(intakeToLocalized(parsed.error));
  try {
    const data = await createAdultIntake({ patientId: input.patientId, data: parsed.data });
    revalidatePath('/[locale]/(staff)/secretary/patients/[id]', 'page');
    return ok(data);
  } catch (err) {
    return fail(intakeToLocalized(err));
  }
}

export async function createPediatricIntakeAction(input: {
  patientId: string;
  data: PediatricIntakeInput;
}): Promise<Result<{ intakeId: string; patientId: string }>> {
  await requirePermission('intake.create');
  const parsed = pediatricIntakeSchema.safeParse(input.data);
  if (!parsed.success) return fail(intakeToLocalized(parsed.error));
  try {
    const data = await createPediatricIntake({ patientId: input.patientId, data: parsed.data });
    revalidatePath('/[locale]/(staff)/secretary/patients/[id]', 'page');
    return ok(data);
  } catch (err) {
    return fail(intakeToLocalized(err));
  }
}
