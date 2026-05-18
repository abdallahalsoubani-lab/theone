import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DayReportForm } from '@/components/clinical/DayReportForm';
import { buildDayReportDraft } from '@/lib/clinical/day-reports/queries';
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

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dateIso = today.toISOString().slice(0, 10);
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
