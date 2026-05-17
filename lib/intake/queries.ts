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
