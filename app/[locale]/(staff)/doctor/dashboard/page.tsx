import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ComplianceTrend } from '@/components/analytics/ComplianceTrend';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getComplianceTrendForDoctor } from '@/lib/analytics/queries';
import { listPendingProposalsForDoctor } from '@/lib/clinical/plans/queries';
import { db } from '@/lib/db';
import { countUnreadNotificationsForCurrentUser } from '@/lib/notifications/queries';

/**
 * Doctor dashboard (Prompt 9 §4.12).
 *
 * Four stat cards across the top, pending proposals list in the
 * middle, recent day-report submissions below. Live data — no
 * placeholders.
 */
export default async function DoctorDashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  const t = await getTranslations('clinical.dashboard');

  const doctorId = session.user.id;
  const since7d = new Date();
  since7d.setUTCDate(since7d.getUTCDate() - 7);

  const [activeCount, pendingProposals, weekNotes, unread, recentReports, complianceTrend] =
    await Promise.all([
      db.treatmentPlan.count({
        where: { doctorId, status: 'ACTIVE' },
      }),
      listPendingProposalsForDoctor(doctorId),
      db.sessionNote.count({
        where: {
          createdAt: { gte: since7d },
          patient: {
            patientProfile: {
              careTeam: { some: { clinicianId: doctorId } },
            },
          },
        },
      }),
      countUnreadNotificationsForCurrentUser(),
      db.dayReport.findMany({
        where: { submittedAt: { gte: since7d } },
        orderBy: { submittedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          date: true,
          therapist: { select: { fullNameEn: true, fullNameAr: true } },
        },
      }),
      getComplianceTrendForDoctor(doctorId, 30),
    ]);

  return (
    <section className="space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('doctorTitle')}</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('activePatients')} value={activeCount} href="/doctor/patients" />
        <Stat
          label={t('pendingProposals')}
          value={pendingProposals.length}
          tone={pendingProposals.length > 0 ? 'cyan' : 'muted'}
        />
        <Stat label={t('weekNotes')} value={weekNotes} />
        <Stat label={t('unreadNotifs')} value={unread} href="/notifications" />
      </div>

      <ComplianceTrend data={complianceTrend} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-navy">{t('pendingProposalsHeading')}</h2>
        {pendingProposals.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {t('noPendingProposals')}
          </p>
        ) : (
          <ul className="divide-y divide-brand-border overflow-hidden rounded-md border border-brand-border bg-brand-surface text-sm">
            {pendingProposals.slice(0, 5).map((p) => {
              const name = locale === 'ar' ? p.patientFullNameAr : p.patientFullNameEn;
              return (
                <li key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <Link
                      href={`/doctor/plans/${p.id}` as `/${string}`}
                      className="font-medium text-brand-navy hover:underline"
                    >
                      {name}
                    </Link>
                    <p className="text-xs text-brand-textMuted">{p.proposalReason ?? ''}</p>
                  </div>
                  <Badge variant="outline">v{p.version}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-navy">{t('recentDayReportsHeading')}</h2>
        {recentReports.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {t('noDayReports')}
          </p>
        ) : (
          <ul className="divide-y divide-brand-border overflow-hidden rounded-md border border-brand-border bg-brand-surface text-sm">
            {recentReports.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-brand-text">
                  {locale === 'ar' ? r.therapist.fullNameAr : r.therapist.fullNameEn}
                </span>
                <span className="text-xs text-brand-textMuted">
                  {r.date.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="text-end">
          <Link href="/doctor/reports/weekly" className="text-xs text-brand-cyan hover:underline">
            {t('openWeeklyReview')}
          </Link>
        </div>
      </section>
    </section>
  );
}

function Stat({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href?: string;
  tone?: 'cyan' | 'muted';
}) {
  const body = (
    <CardContent className="space-y-1 p-4">
      <p className="text-xs uppercase tracking-wide text-brand-textMuted">{label}</p>
      <p
        className={`text-2xl font-medium ${tone === 'cyan' ? 'text-brand-cyan' : 'text-brand-navy'}`}
      >
        {value}
      </p>
    </CardContent>
  );
  if (href) {
    return (
      <Link href={href as `/${string}`} className="block">
        <Card className="hover:border-brand-cyan/50">{body}</Card>
      </Link>
    );
  }
  return <Card>{body}</Card>;
}
