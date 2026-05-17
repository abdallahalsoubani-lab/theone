import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

export interface PatientActivityRow {
  id: string;
  createdAt: Date;
  entityType: string;
  action: string;
  actor: { id: string; fullNameEn: string; fullNameAr: string; role: string } | null;
}

/**
 * Audit-log feed scoped to a single patient.
 *
 * Includes entries whose `entityId` is the patient's userId for the entity
 * types that hold patient-affecting state: User, PatientProfile,
 * IntakeAssessment, AdultIntakeData, PediatricIntakeData, IntakeCustomAnswer.
 * As later prompts add patient-affecting modules (Appointment, TreatmentPlan,
 * SessionNote, HomeProgramItem) extend the entityType array.
 *
 * Intake-related entities use the IntakeAssessment id, not the patientId, so
 * we resolve those via a subquery first.
 */
const PATIENT_AFFECTING_TYPES = ['User', 'PatientProfile'] as const;

const INTAKE_AFFECTING_TYPES = [
  'IntakeAssessment',
  'AdultIntakeData',
  'PediatricIntakeData',
  'IntakeCustomAnswer',
] as const;

export async function listPatientActivity(
  patientId: string,
  limit = 50,
): Promise<PatientActivityRow[]> {
  // Find every intake id (and child detail ids) that belongs to this patient.
  const intakes = await db.intakeAssessment.findMany({
    where: { patientId },
    select: { id: true, customAnswers: { select: { id: true } } },
  });
  const intakeIds = intakes.map((i) => i.id);
  const answerIds = intakes.flatMap((i) => i.customAnswers.map((a) => a.id));

  const where: Prisma.AuditLogWhereInput = {
    OR: [
      // Direct patient entities.
      { entityType: { in: [...PATIENT_AFFECTING_TYPES] }, entityId: patientId },
      // Intake parent + detail rows.
      ...(intakeIds.length > 0
        ? [
            {
              entityType: { in: [...INTAKE_AFFECTING_TYPES] },
              entityId: { in: [...intakeIds, ...answerIds] },
            },
          ]
        : []),
    ],
  };

  const rows = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      actor: { select: { id: true, fullNameEn: true, fullNameAr: true, role: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    entityType: r.entityType,
    action: r.action,
    actor: r.actor,
  }));
}
