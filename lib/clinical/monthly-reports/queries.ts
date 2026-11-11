import { db } from '@/lib/db';

export interface MonthlyReportRow {
  id: string;
  month: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  authorId: string;
  authorFullNameEn: string;
  authorFullNameAr: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Every monthly report for a patient, newest month first. */
export async function listMonthlyReports(patientId: string): Promise<MonthlyReportRow[]> {
  const rows = await db.monthlyReport.findMany({
    where: { patientId },
    orderBy: { month: 'desc' },
    select: {
      id: true,
      month: true,
      subjective: true,
      objective: true,
      assessment: true,
      plan: true,
      authorId: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map(({ author, ...r }) => ({
    ...r,
    authorFullNameEn: author.fullNameEn,
    authorFullNameAr: author.fullNameAr,
  }));
}
