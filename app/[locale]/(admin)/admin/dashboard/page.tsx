import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CancellationCategoryTable } from '@/components/analytics/CancellationCategoryTable';
import { DiagnosesBar } from '@/components/analytics/DiagnosesBar';
import { KpiCard } from '@/components/analytics/KpiCard';
import { ReferralDonut } from '@/components/analytics/ReferralDonut';
import { TrendLine } from '@/components/analytics/TrendLine';
import {
  getActivePatientCount,
  getCancellationCategories,
  getComplianceAverage,
  getMonthlyTrend,
  getNoShowRate,
  getReferralSources,
  getTopDiagnoses,
  getUtilization,
} from '@/lib/analytics/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Admin dashboard (Prompt 11 §4.2.1). Replaces the Prompt 4 role
 * placeholder. Six widgets driven by `lib/analytics/queries.ts`, each
 * 5-minute Redis-cached so the page stays snappy on a busy clinic day.
 *
 * Date range conventions:
 *   - KPI row + cancellation table: last 30 days.
 *   - Monthly trend: last 6 months.
 *   - Top diagnoses + referral sources: last 90 days (long enough to
 *     surface real patterns, short enough to weight current operations).
 */
export default async function AdminDashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('reports.read');
  const t = await getTranslations('analytics');

  const now = new Date();
  const last30 = { from: addDays(now, -30), to: now };
  const last90 = { from: addDays(now, -90), to: now };
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthRange = { from: startOfMonth, to: now };

  const [
    activePatients,
    monthlyAppts,
    noShow,
    compliance,
    utilization,
    trend,
    diagnoses,
    referrals,
    cancellations,
  ] = await Promise.all([
    getActivePatientCount(),
    countMonthAppointments(monthRange),
    getNoShowRate(last30),
    getComplianceAverage(last30),
    getUtilization(last30),
    getMonthlyTrend(6),
    getTopDiagnoses(5, last90),
    getReferralSources(last90),
    getCancellationCategories(last30),
  ]);

  return (
    <section className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('dashboardTitle')}</h1>
        <p className="text-sm text-brand-textMuted">{t('dashboardSubtitle')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t('kpi.activePatients')} value={String(activePatients)} />
        <KpiCard label={t('kpi.monthAppointments')} value={String(monthlyAppts)} />
        <KpiCard
          label={t('kpi.noShowRate')}
          value={`${noShow.noShowPct}%`}
          hint={`${noShow.noShowCount} / ${noShow.finishedCount}`}
        />
        <KpiCard label={t('kpi.complianceAverage')} value={`${compliance}%`} />
      </div>

      <div className="grid gap-4">
        <TrendLine data={trend} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DiagnosesBar data={diagnoses} />
        <ReferralDonut data={referrals} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CancellationCategoryTable rows={cancellations} />
        <KpiCard
          label={t('kpi.utilization')}
          value={`${utilization.utilizationPct}%`}
          hint={`${utilization.bookedMinutes} / ${utilization.availableMinutes} min`}
        />
      </div>
    </section>
  );
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

async function countMonthAppointments(range: { from: Date; to: Date }): Promise<number> {
  const { db } = await import('@/lib/db');
  return db.appointment.count({ where: { startsAt: { gte: range.from, lte: range.to } } });
}
