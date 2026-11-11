import { getTranslations } from 'next-intl/server';

import { MonthlyReportEditor } from '@/components/clinical/MonthlyReportEditor';
import { listMonthlyReports } from '@/lib/clinical/monthly-reports/queries';
import { currentClinicMonth } from '@/lib/clinical/monthly-reports/services';
import { getClinicTimeZone } from '@/lib/time/clinic-server';

/**
 * P64 #11 — «التقارير الشهرية» on the patient file's notes tab: the monthly
 * SOAP reports, newest first, above the per-session results. Therapists and
 * doctors write (the editor); secretary / admin read.
 */
export async function MonthlyReportsPanel({
  patientId,
  locale,
  canWrite,
}: {
  patientId: string;
  locale: string;
  canWrite: boolean;
}) {
  const t = await getTranslations('clinical.monthlyReports');
  const [reports, tz] = await Promise.all([listMonthlyReports(patientId), getClinicTimeZone()]);
  const currentMonth = currentClinicMonth(new Date(), tz);
  const monthLabel = (month: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${month}-15T12:00:00Z`));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand-navy">{t('heading')}</h3>
      </div>
      {canWrite ? (
        <MonthlyReportEditor
          patientId={patientId}
          currentMonth={currentMonth}
          existing={reports.map((r) => ({
            month: r.month,
            subjective: r.subjective,
            objective: r.objective,
            assessment: r.assessment,
            plan: r.plan,
          }))}
        />
      ) : null}
      {reports.length === 0 ? (
        <p className="text-sm text-brand-textMuted">{t('empty')}</p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li
              key={r.id}
              className="space-y-2 rounded-md border border-brand-border bg-brand-surface p-4"
            >
              <p className="text-sm font-medium text-brand-navy">
                {monthLabel(r.month)}{' '}
                <span className="text-xs font-normal text-brand-textMuted">
                  · <bdi>{locale === 'ar' ? r.authorFullNameAr : r.authorFullNameEn}</bdi>
                </span>
              </p>
              {(
                [
                  ['subjective', r.subjective],
                  ['objective', r.objective],
                  ['assessment', r.assessment],
                  ['plan', r.plan],
                ] as const
              ).map(([key, value]) =>
                value ? (
                  <div key={key}>
                    <p className="text-[10px] uppercase tracking-wide text-brand-textMuted">
                      {t(key)}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-brand-text">{value}</p>
                  </div>
                ) : null,
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
