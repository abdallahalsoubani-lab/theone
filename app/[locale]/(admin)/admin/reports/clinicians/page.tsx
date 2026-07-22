import { setRequestLocale } from 'next-intl/server';

import { ClinicianSummaryReport } from '@/components/reports/ClinicianSummaryReport';
import { db } from '@/lib/db';
import { resolveReportRange } from '@/lib/reports/params';
import { requirePermission } from '@/lib/rbac/guards';

/** Clinician sessions summary — ADMIN entry (Prompt 40; DOCTOR has its own
 *  wrapper under /doctor/reports/clinicians). */
export default async function AdminClinicianSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('reports.clinician_summary');
  const sp = await searchParams;
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true },
  });
  const range = resolveReportRange(sp, new Date(), settings?.timezone ?? undefined);
  return (
    <ClinicianSummaryReport
      range={range}
      basePath="/admin/reports/clinicians"
      locale={locale === 'ar' ? 'ar' : 'en'}
    />
  );
}
