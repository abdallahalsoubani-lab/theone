import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { ComplianceTrend } from '@/components/analytics/ComplianceTrend';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getComplianceTrendForDoctor } from '@/lib/analytics/queries';
import { listTodayAppointmentsForClinician } from '@/lib/appointments/queries';
import { clinicDayRange } from '@/lib/arrivals/time';
import { listPendingProposalsForDoctor } from '@/lib/clinical/plans/queries';
import { db } from '@/lib/db';
import { getEffectiveSession } from '@/lib/impersonation/session';
import { formatShortDate, formatTime } from '@/lib/format/date';
import { CLINIC_TIME_ZONE } from '@/lib/format/locale';
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
  // Effective session so Act-As loads the impersonated doctor's data
  // instead of the Admin's empty dashboard (Prompt 22 §3.2).
  const session = await getEffectiveSession();
  if (!session?.user) redirect(`/${locale}/login`);
  const t = await getTranslations('clinical.dashboard');

  const doctorId = session.user.id;
  const since7d = new Date();
  since7d.setUTCDate(since7d.getUTCDate() - 7);

  // PT-B1 item 2: the dashboard shows THIS doctor's appointments for the
  // clinic-local day — the Prompt 39 clinic-wide ruling is reversed. The
  // clinic-wide view lives on the calendar; a dashboard is a personal surface.
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true },
  });
  const { start: today, end: tomorrow } = clinicDayRange(
    new Date(),
    settings?.timezone ?? CLINIC_TIME_ZONE,
  );

  const [
    todayAppts,
    activeCount,
    pendingProposals,
    weekNotes,
    unread,
    recentReports,
    complianceTrend,
  ] = await Promise.all([
    // doctorId is the session user — never a searchParam (this page takes none).
    listTodayAppointmentsForClinician({
      clinicianId: doctorId,
      dayStart: today,
      dayEnd: tomorrow,
    }),
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
        <Stat label={t('todayAppts')} value={todayAppts.length} href="/doctor/calendar" />
        <Stat label={t('activePatients')} value={activeCount} href="/doctor/patients" />
        <Stat
          label={t('pendingProposals')}
          value={pendingProposals.length}
          tone={pendingProposals.length > 0 ? 'cyan' : 'muted'}
        />
        <Stat label={t('weekNotes')} value={weekNotes} />
        <Stat label={t('unreadNotifs')} value={unread} href="/notifications" />
      </div>

      {/* This doctor's own appointments for the clinic day (PT-B1 item 2).
          Compact chronological rows + internal scroll + a total in the
          heading; the co-treating clinicians stay listed because a session
          can carry several. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-navy">
          {t('todayScheduleHeading')}{' '}
          <span className="font-normal text-brand-textMuted">({todayAppts.length})</span>
        </h2>
        {todayAppts.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {t('noAppointmentsToday')}
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-brand-border overflow-y-auto rounded-md border border-brand-border bg-brand-surface text-sm">
            {todayAppts.map((a) => {
              const name =
                (locale === 'ar' ? a.patient?.fullNameAr : a.patient?.fullNameEn) ||
                (a.title ?? '');
              const therapists = a.therapists
                .map((th) => (locale === 'ar' ? th.fullNameAr : th.fullNameEn))
                .join(locale === 'ar' ? '، ' : ', ');
              const href = a.patientId
                ? (`/doctor/patients/${a.patientId}` as const)
                : ('/doctor/calendar' as const);
              return (
                <li key={a.id}>
                  <Link
                    href={href as `/${string}`}
                    className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-brand-bg"
                  >
                    <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-brand-textMuted">
                      {formatTime(a.startsAt, locale === 'ar' ? 'ar' : 'en')}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-brand-navy">
                      {name}
                    </span>
                    <span className="hidden max-w-[14rem] truncate text-xs text-brand-textMuted sm:block">
                      {therapists}
                    </span>
                    {a.checkedInAt ? (
                      <span
                        aria-hidden
                        title={t('arrived')}
                        className="h-2 w-2 shrink-0 rounded-full bg-brand-teal"
                      />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
                  {formatShortDate(r.date, locale === 'ar' ? 'ar' : 'en')}
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
