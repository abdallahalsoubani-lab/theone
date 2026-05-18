import 'server-only';

import { db } from '@/lib/db';

export interface DoctorReviewRow {
  id: string;
  doctorId: string;
  doctorFullNameEn: string;
  doctorFullNameAr: string;
  patientId: string;
  weekStarting: Date;
  comment: string;
  createdAt: Date;
}

export async function listDoctorReviewsForPatient(patientId: string): Promise<DoctorReviewRow[]> {
  const rows = await db.doctorReview.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      doctorId: true,
      patientId: true,
      weekStarting: true,
      comment: true,
      createdAt: true,
      doctor: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    doctorId: r.doctorId,
    doctorFullNameEn: r.doctor.fullNameEn,
    doctorFullNameAr: r.doctor.fullNameAr,
    patientId: r.patientId,
    weekStarting: r.weekStarting,
    comment: r.comment,
    createdAt: r.createdAt,
  }));
}
