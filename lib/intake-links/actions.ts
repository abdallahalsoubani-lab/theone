'use server';

import { AuditAction, type IntakeType } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { fail, ok, type Result } from '@/lib/auth/result';
import { db, toLocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { generateIntakeToken } from './tokens';

/**
 * P52 — regenerate a personal intake link for a patient (SECRETARY/ADMIN),
 * so a link can be re-sent manually if the WhatsApp message never arrived.
 * Audited. Old UNUSED links stay valid (simple + forgiving — a patient who
 * kept the first message can still use it); the newest is the one the file
 * surfaces. `formType` defaults to the patient's most recent link, else the
 * caller passes it.
 */
export async function regenerateIntakeLinkAction(input: {
  patientId: string;
  formType: IntakeType;
}): Promise<Result<{ token: string }>> {
  await requirePermission('patients.create');
  const session = await auth();
  if (!session?.user?.id) {
    return fail({
      code: 'UNAUTHENTICATED',
      message_en: 'Sign-in required.',
      message_ar: 'يلزم تسجيل الدخول.',
    });
  }
  try {
    const patient = await db.user.findFirst({
      where: { id: input.patientId, role: 'PATIENT', deletedAt: null },
      select: { id: true },
    });
    if (!patient) {
      return fail({
        code: 'PATIENT_NOT_FOUND',
        message_en: 'Patient not found.',
        message_ar: 'المريض غير موجود.',
      });
    }
    const token = generateIntakeToken();
    const link = await db.patientIntakeLink.create({
      data: {
        patientId: input.patientId,
        token,
        formType: input.formType,
        createdById: session.user.id,
      },
      select: { id: true },
    });
    await db.auditLog.create({
      data: {
        actorId: session.user.id,
        entityType: 'PatientIntakeLink',
        entityId: link.id,
        action: AuditAction.CREATE,
        after: {
          event: 'INTAKE_LINK_REGENERATED',
          patientId: input.patientId,
          formType: input.formType,
        },
      },
    });
    revalidatePath('/[locale]/(staff)/secretary/patients/[id]', 'page');
    revalidatePath('/[locale]/(admin)/admin/patients/[id]', 'page');
    return ok({ token });
  } catch (err) {
    return fail(toLocalizedError(err));
  }
}
