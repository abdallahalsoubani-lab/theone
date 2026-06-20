import type { IntakeStatus, IntakeType } from '@prisma/client';

import { db } from '@/lib/db';

export interface IntakeListRow {
  id: string;
  type: IntakeType;
  status: IntakeStatus;
  assessedAt: Date;
  assessedBy: { id: string; fullNameEn: string; fullNameAr: string } | null;
  reviewedByClinician: { id: string; fullNameEn: string; fullNameAr: string } | null;
  reviewedAt: Date | null;
}

export interface IntakeAssessmentDetail {
  id: string;
  patientId: string;
  type: IntakeType;
  status: IntakeStatus;
  assessedAt: Date;
  assessedByEn: string | null;
  assessedByAr: string | null;
  reviewedByEn: string | null;
  reviewedByAr: string | null;
  /** Typed adult columns (null for pediatric), as a plain record for the view. */
  adult: Record<string, unknown> | null;
  pediatric: Record<string, unknown> | null;
  custom: Array<{ nameEn: string; nameAr: string; value: string }>;
}

/** Read-only detail for the patient-file "View" link (Fix 6B item 4). */
export async function getIntakeAssessmentById(id: string): Promise<IntakeAssessmentDetail | null> {
  const row = await db.intakeAssessment.findUnique({
    where: { id },
    include: {
      assessedBy: { select: { fullNameEn: true, fullNameAr: true } },
      reviewedByClinician: { select: { fullNameEn: true, fullNameAr: true } },
      adultData: true,
      pediatricData: true,
      customAnswers: {
        include: { question: { select: { nameEn: true, nameAr: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!row) return null;

  const custom = row.customAnswers.map((a) => {
    const options = (a.valueOptions as string[] | null) ?? null;
    const value = options && options.length > 0 ? options.join(', ') : (a.value ?? '');
    return { nameEn: a.question.nameEn, nameAr: a.question.nameAr, value };
  });

  return {
    id: row.id,
    patientId: row.patientId,
    type: row.type,
    status: row.status,
    assessedAt: row.assessedAt,
    assessedByEn: row.assessedBy?.fullNameEn ?? null,
    assessedByAr: row.assessedBy?.fullNameAr ?? null,
    reviewedByEn: row.reviewedByClinician?.fullNameEn ?? null,
    reviewedByAr: row.reviewedByClinician?.fullNameAr ?? null,
    adult: (row.adultData as Record<string, unknown> | null) ?? null,
    pediatric: (row.pediatricData as Record<string, unknown> | null) ?? null,
    custom,
  };
}

export async function listIntakesForPatient(patientId: string): Promise<IntakeListRow[]> {
  const rows = await db.intakeAssessment.findMany({
    where: { patientId },
    orderBy: { assessedAt: 'desc' },
    include: {
      assessedBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      reviewedByClinician: { select: { id: true, fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    assessedAt: r.assessedAt,
    assessedBy: r.assessedBy,
    reviewedByClinician: r.reviewedByClinician,
    reviewedAt: r.reviewedAt,
  }));
}
