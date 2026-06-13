import { AuditAction, UserRole, type Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';

import { PedAssessmentError, PED_ERRORS } from './errors';

/** Drop empty custom values; keep the rest as-is (custom fields are flexible). */
export function cleanCustomData(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export const createPediatricAssessment = withAudit<
  [{ patientId: string; coreData: Record<string, unknown>; customData: Record<string, unknown> }],
  { id: string; patientId: string }
>(
  {
    entityType: 'PediatricAssessment',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.id,
    extractAfter: (result) => ({ event: 'PED_ASSESSMENT_CREATED', id: result.id }),
  },
  async function createInner(input): Promise<{ id: string; patientId: string }> {
    const session = await auth();
    if (!session?.user?.id) throw new PedAssessmentError(PED_ERRORS.UNAUTHENTICATED);

    const patient = await db.user.findUnique({
      where: { id: input.patientId },
      select: { id: true, role: true },
    });
    if (!patient || patient.role !== UserRole.PATIENT) {
      throw new PedAssessmentError(PED_ERRORS.PATIENT_NOT_FOUND);
    }

    const row = await db.pediatricAssessment.create({
      data: {
        patientId: input.patientId,
        createdById: session.user.id,
        coreData: input.coreData as Prisma.InputJsonValue,
        customData: cleanCustomData(input.customData) as Prisma.InputJsonValue,
      },
      select: { id: true, patientId: true },
    });
    return row;
  },
);

export const updatePediatricAssessment = withAudit<
  [{ id: string; coreData: Record<string, unknown>; customData: Record<string, unknown> }],
  { id: string; patientId: string }
>(
  {
    entityType: 'PediatricAssessment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'PED_ASSESSMENT_UPDATED' }),
  },
  async function updateInner(input): Promise<{ id: string; patientId: string }> {
    const session = await auth();
    if (!session?.user?.id) throw new PedAssessmentError(PED_ERRORS.UNAUTHENTICATED);

    const existing = await db.pediatricAssessment.findUnique({
      where: { id: input.id },
      select: { id: true, patientId: true },
    });
    if (!existing) throw new PedAssessmentError(PED_ERRORS.NOT_FOUND);

    await db.pediatricAssessment.update({
      where: { id: input.id },
      data: {
        coreData: input.coreData as Prisma.InputJsonValue,
        customData: cleanCustomData(input.customData) as Prisma.InputJsonValue,
        updatedById: session.user.id,
      },
    });
    return { id: input.id, patientId: existing.patientId };
  },
);
