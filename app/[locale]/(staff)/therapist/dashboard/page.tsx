import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ScheduleDensity } from '@/components/analytics/ScheduleDensity';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getScheduleDensityForTherapist } from '@/lib/analytics/queries';
import { listAppointmentsPendingNote } from '@/lib/clinical/session-notes/queries';
import { db } from '@/lib/db';
import { countUnreadNotificationsForCurrentUser } from '@/lib/notifications/queries';

/**
 * Therapist dashboard (Prompt 9 §4.13).
 *
 * Four stat cards (today's appts, pending notes, assigned patients,
 * unread notifs), today's schedule strip, pending notes list. Live
 * data — no placeholders.
 */
export default async function TherapistDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  const t = await getTranslations('clinical.dashboard');
  const therapistId = session.user.id;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const [todayAppts, pendingNotes, assignedCount, unread, scheduleDensity] = await Promise.all([
    db.appointment.findMany({
      where: {
        therapistId,
        startsAt: { gte: today, lt: tomorrow },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        status: true,
        patient: { select: { fullNameEn: true, fullNameAr: true } },
      },
    }),
    listAppointmentsPendingNote(therapistId, 5),
    db.careTeamMember.count({ where: { clinicianId: therapistId, role: 'THERAPIST' } }),
    countUnreadNotificationsForCurrentUser(),
    getScheduleDensityForTherapist(therapistId),
  ]);

  return (
    <section className="space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('therapistTitle')}</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('todayAppts')} value={todayAppts.length} href="/secretary/calendar" />
        <Stat
          label={t('pendingNotes')}
          value={pendingNotes.length}
          tone={pendingNotes.length > 0 ? 'cyan' : 'muted'}
        />
        <Stat label={t('assignedPatients')} value={assignedCount} href="/therapist/patients" />
        <Stat label={t('unreadNotifs')} value={unread} href="/notifications" />
      </div>

      <ScheduleDensity data={scheduleDensity} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-navy">{t('todayScheduleHeading')}</h2>
        {todayAppts.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {t('noAppointmentsToday')}
          </p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto pb-2 text-sm">
            {todayAppts.map((a) => {
              const name = locale === 'ar' ? a.patient.fullNameAr : a.patient.fullNameEn;
              return (
                <li
                  key={a.id}
                  className="min-w-[10rem] rounded-md border border-brand-border bg-brand-surface p-3"
                >
                  <p className="text-xs text-brand-textMuted">
                    {a.startsAt.toLocaleTimeString(locale === 'ar' ? 'ar' : 'en', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="line-clamp-1 text-sm font-medium text-brand-navy">{name}</p>
                  <p className="text-xs text-brand-textMuted">{a.status}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-navy">{t('pendingNotesHeading')}</h2>
        {pendingNotes.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {t('noPendingNotes')}
          </p>
        ) : (
          <ul className="divide-y divide-brand-border overflow-hidden rounded-md border border-brand-border bg-brand-surface text-sm">
            {pendingNotes.map((a) => {
              const name = locale === 'ar' ? a.patientFullNameAr : a.patientFullNameEn;
              return (
                <li key={a.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <Link
                      href={`/therapist/sessions/${a.id}/note/new` as `/${string}`}
                      className="font-medium text-brand-navy hover:underline"
                    >
                      {name}
                    </Link>
                    <p className="text-xs text-brand-textMuted">
                      {a.startsAt.toLocaleString(locale === 'ar' ? 'ar' : 'en')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="text-end">
        <Link
          href="/therapist/reports/end-of-day"
          className="text-sm text-brand-cyan hover:underline"
        >
          {t('openEndOfDay')}
        </Link>
      </div>
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
