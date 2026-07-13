import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DayReportForm } from '@/components/clinical/DayReportForm';
import { buildDayReportDraft } from '@/lib/clinical/day-reports/queries';
import { CLINIC_TIME_ZONE } from '@/lib/format/locale';
import { requirePermission } from '@/lib/rbac/guards';

export default async function EndOfDayReportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('reports.submit');
  const t = await getTranslations('clinical.reports');
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);

  // Clinic-local calendar day, not the UTC day (they differ 21:00–24:00 UTC).
  // The report key stays midnight-UTC of that YYYY-MM-DD so the @db.Date
  // column round-trips (see lib/clinical/day-reports/services.ts parseDate).
  const dateIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const today = new Date(`${dateIso}T00:00:00.000Z`);
  const { patientEntries, existing } = await buildDayReportDraft({
    therapistId: session.user.id,
    date: today,
  });

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('endOfDayTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('endOfDaySubtitle')}</p>
        <p className="mt-1 text-xs text-brand-textMuted">
          {t('date')}: {dateIso}
        </p>
      </header>
      <DayReportForm
        date={dateIso}
        initialOverallSummary={existing?.overallSummary ?? ''}
        initialEntries={patientEntries}
      />
    </section>
  );
}
