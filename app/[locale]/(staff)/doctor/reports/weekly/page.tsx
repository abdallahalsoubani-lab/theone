import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DoctorReviewComposer } from '@/components/clinical/DoctorReviewComposer';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';
import { listDayReportsForDoctorWeek } from '@/lib/clinical/day-reports/queries';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Doctor weekly review page (Prompt 9 §4.10).
 *
 * Aggregates last 7 days of DayReport rows grouped by patient. The
 * doctor adds a per-patient DoctorReview via the composer beneath
 * each group.
 */
export default async function WeeklyReviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('reports.review');
  const t = await getTranslations('clinical.reports');
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);

  // Week starting Monday of the current week (UTC).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dow = today.getUTCDay(); // 0 = Sun
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((dow + 6) % 7));
  const weekStartingIso = monday.toISOString().slice(0, 10);

  const reports = await listDayReportsForDoctorWeek({
    doctorId: session.user.id,
    weekStarting: monday,
  });

  // Group reports by patientId; collect all entries per patient
  const byPatient = new Map<
    string,
    Array<{
      reportId: string;
      date: Date;
      therapistFullNameEn: string;
      therapistFullNameAr: string;
      note: string;
    }>
  >();
  for (const r of reports) {
    for (const e of r.patientEntries) {
      const arr = byPatient.get(e.patientId) ?? [];
      arr.push({
        reportId: r.id,
        date: r.date,
        therapistFullNameEn: r.therapistFullNameEn,
        therapistFullNameAr: r.therapistFullNameAr,
        note: e.note,
      });
      byPatient.set(e.patientId, arr);
    }
  }

  const patientIds = Array.from(byPatient.keys());
  const patients =
    patientIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: patientIds } },
          select: { id: true, fullNameEn: true, fullNameAr: true },
        })
      : [];

  return (
    <section className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('weeklyReviewTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">
          {t('weekOf')} {weekStartingIso}
        </p>
      </header>

      {patientIds.length === 0 ? (
        <div className="rounded-md border border-brand-border bg-brand-surface p-12 text-center text-sm text-brand-textMuted">
          {t('noDayReports')}
        </div>
      ) : (
        <ul className="space-y-4">
          {patients.map((p) => {
            const entries = byPatient.get(p.id) ?? [];
            const name = locale === 'ar' ? p.fullNameAr : p.fullNameEn;
            return (
              <li
                key={p.id}
                className="space-y-3 rounded-md border border-brand-border bg-brand-surface p-4"
              >
                <header className="flex items-center justify-between gap-2">
                  <Link
                    href={`/doctor/patients/${p.id}` as `/${string}`}
                    className="text-lg font-medium text-brand-navy hover:underline"
                  >
                    {name}
                  </Link>
                  <Badge variant="muted">
                    {entries.length} {t('entries')}
                  </Badge>
                </header>
                <ul className="space-y-2 text-sm">
                  {entries.map((e, i) => (
                    <li key={i} className="border-s-2 border-brand-cyan/40 ps-3">
                      <p className="text-xs text-brand-textMuted">
                        {e.date.toISOString().slice(0, 10)} ·{' '}
                        {locale === 'ar' ? e.therapistFullNameAr : e.therapistFullNameEn}
                      </p>
                      <p className="whitespace-pre-wrap text-brand-text">{e.note}</p>
                    </li>
                  ))}
                </ul>
                <DoctorReviewComposer patientId={p.id} weekStarting={weekStartingIso} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
