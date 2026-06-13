import { db } from '@/lib/db';

export interface AssessmentListRow {
  id: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  edited: boolean;
  createdByNameEn: string;
  createdByNameAr: string;
  updatedByNameEn: string | null;
  updatedByNameAr: string | null;
  /** The §4 "date" field value from coreData (the clinical assessment date). */
  assessmentDate: string | null;
}

export async function listAssessmentsForPatient(patientId: string): Promise<AssessmentListRow[]> {
  const rows = await db.pediatricAssessment.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      coreData: true,
      createdAt: true,
      updatedAt: true,
      updatedById: true,
      createdBy: { select: { fullNameEn: true, fullNameAr: true } },
      updatedBy: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map((r) => {
    const core = (r.coreData ?? {}) as Record<string, unknown>;
    const date = typeof core.date === 'string' ? core.date : null;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      edited: r.updatedById != null && r.updatedAt.getTime() !== r.createdAt.getTime(),
      createdByNameEn: r.createdBy.fullNameEn,
      createdByNameAr: r.createdBy.fullNameAr,
      updatedByNameEn: r.updatedBy?.fullNameEn ?? null,
      updatedByNameAr: r.updatedBy?.fullNameAr ?? null,
      assessmentDate: date,
    };
  });
}

export interface AssessmentDetail {
  id: string;
  patientId: string;
  coreData: Record<string, unknown>;
  customData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  createdByNameEn: string;
  createdByNameAr: string;
  updatedByNameEn: string | null;
  updatedByNameAr: string | null;
}

export async function getAssessmentById(id: string): Promise<AssessmentDetail | null> {
  const r = await db.pediatricAssessment.findUnique({
    where: { id },
    select: {
      id: true,
      patientId: true,
      coreData: true,
      customData: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { fullNameEn: true, fullNameAr: true } },
      updatedBy: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    patientId: r.patientId,
    coreData: (r.coreData ?? {}) as Record<string, unknown>,
    customData: (r.customData ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdByNameEn: r.createdBy.fullNameEn,
    createdByNameAr: r.createdBy.fullNameAr,
    updatedByNameEn: r.updatedBy?.fullNameEn ?? null,
    updatedByNameAr: r.updatedBy?.fullNameAr ?? null,
  };
}
