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

  // NI-1 (Prompt 33): the doctor's OWN bookings — doctors are bookable
  // clinicians (calendar resource lanes include DOCTOR), so "the doctor's
  // appointments" = rows where the doctor is an assigned clinician in the
  // AppointmentTherapist M2M. Clinic-local "today", same as the therapist
  // dashboard.
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
    listTodayAppointmentsForClinician({ clinicianId: doctorId, dayStart: today, dayEnd: tomorrow }),
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

      {/* NI-1 (Prompt 33): the doctor's own booked appointments for the
          clinic-local day — mirrors the therapist dashboard strip. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-navy">{t('todayScheduleHeading')}</h2>
        {todayAppts.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {t('noAppointmentsToday')}
          </p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto pb-2 text-sm">
            {todayAppts.map((a) => {
              const name =
                (locale === 'ar' ? a.patient?.fullNameAr : a.patient?.fullNameEn) ||
                (a.title ?? '');
              const href = a.patientId
                ? (`/doctor/patients/${a.patientId}` as const)
                : ('/doctor/calendar' as const);
              return (
                <li key={a.id} className="min-w-[10rem]">
                  <Link
                    href={href as `/${string}`}
                    className="block rounded-md border border-brand-border bg-brand-surface p-3 transition-colors hover:border-brand-cyan hover:bg-brand-bg"
                  >
                    <p className="text-xs text-brand-textMuted">
                      {formatTime(a.startsAt, locale === 'ar' ? 'ar' : 'en')}
                    </p>
                    <p className="line-clamp-1 text-sm font-medium text-brand-navy">{name}</p>
                    {a.checkedInAt ? (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-brand-teal/15 px-2 py-0.5 text-xs font-medium text-brand-teal">
                        ● {t('arrived')}
                      </span>
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
