'use server';

import { revalidatePath } from 'next/cache';

import { fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import { coreAssessmentSchema } from './coreSchema';
import { pedToLocalized } from './customFields/services';
import { assessmentCreateSchema, assessmentUpdateSchema } from './schemas';
import { createPediatricAssessment, updatePediatricAssessment } from './services';

function revalidate(): void {
  revalidatePath('/[locale]/(staff)/doctor/patients/[id]', 'page');
  revalidatePath('/[locale]/(staff)/therapist/patients/[id]', 'page');
}

export async function createAssessmentAction(
  input: unknown,
): Promise<Result<{ id: string; patientId: string }>> {
  await requirePermission('pediatric_assessment.create');
  const parsed = assessmentCreateSchema.safeParse(input);
  if (!parsed.success) return fail(pedToLocalized(parsed.error));
  // Strict core validation (rejects unknown keys / out-of-enum / missing
  // required observations / NICU=Yes without days).
  const core = coreAssessmentSchema.safeParse(parsed.data.coreData);
  if (!core.success) return fail(pedToLocalized(core.error));
  try {
    const data = await createPediatricAssessment({
      patientId: parsed.data.patientId,
      coreData: core.data as Record<string, unknown>,
      customData: parsed.data.customData,
    });
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(pedToLocalized(err));
  }
}

export async function updateAssessmentAction(
  input: unknown,
): Promise<Result<{ id: string; patientId: string }>> {
  await requirePermission('pediatric_assessment.update');
  const parsed = assessmentUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(pedToLocalized(parsed.error));
  const core = coreAssessmentSchema.safeParse(parsed.data.coreData);
  if (!core.success) return fail(pedToLocalized(core.error));
  try {
    const data = await updatePediatricAssessment({
      id: parsed.data.id,
      coreData: core.data as Record<string, unknown>,
      customData: parsed.data.customData,
    });
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(pedToLocalized(err));
  }
}
