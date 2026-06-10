import { AppointmentStatus } from '@prisma/client';
import { Calendar, Home, User } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getVisibleHomeProgram } from '@/lib/clinical/home-program/approval';
import { db } from '@/lib/db';
import { formatDate, formatTime } from '@/lib/format/date';

export default async function PatientDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== 'PATIENT') redirect(`/${locale}/`);
  const t = await getTranslations('patient.portal');
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const name = locale === 'ar' ? session.user.fullNameAr : session.user.fullNameEn;
  const patientId = session.user.id;

  // Past 7 days for the day-dots strip — Sunday-anchored so the week
  // visualization matches the rest of the app's calendar conventions.
  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const [nextAppointment, activeItemsCount, weekCompletions] = await Promise.all([
    db.appointment.findFirst({
      where: {
        patientId,
        status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
        startsAt: { gte: new Date() },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        startsAt: true,
        durationMinutes: true,
        therapist: { select: { fullNameEn: true, fullNameAr: true } },
      },
    }),
    // Approved-visible active items only (Prompt 16).
    getVisibleHomeProgram(patientId).then((items) => items.filter((i) => i.active).length),
    db.homeProgramCompletion.findMany({
      where: {
        item: { patientId },
        scheduledDate: { gte: startOfWeek, lt: endOfWeek },
      },
      select: { scheduledDate: true, completedAt: true },
    }),
  ]);

  const weekDots: Array<{ day: string; completed: boolean; scheduled: boolean }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    const dayCompletions = weekCompletions.filter(
      (c) =>
        c.scheduledDate.getFullYear() === d.getFullYear() &&
        c.scheduledDate.getMonth() === d.getMonth() &&
        c.scheduledDate.getDate() === d.getDate(),
    );
    weekDots.push({
      day: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][i]!,
      completed: dayCompletions.some((c) => c.completedAt),
      scheduled: dayCompletions.length > 0,
    });
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-medium text-brand-navy">{t('dashboardTitle', { name })}</h1>
      </header>

      <Card>
        <CardContent className="space-y-2 p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-brand-navy">
            <Calendar className="size-4 text-brand-cyan" />
            {t('nextAppointmentTitle')}
          </div>
          {nextAppointment ? (
            <p className="text-sm text-brand-navy">
              {formatDate(nextAppointment.startsAt, intlLocale)} ·{' '}
              {formatTime(nextAppointment.startsAt, intlLocale)} ·{' '}
              {locale === 'ar'
                ? nextAppointment.therapist.fullNameAr
                : nextAppointment.therapist.fullNameEn}
            </p>
          ) : (
            <p className="text-sm text-brand-textMuted">{t('nextAppointmentPlaceholder')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-brand-navy">
            <Home className="size-4 text-brand-cyan" />
            {t('homeProgramTitle')}
          </div>
          {activeItemsCount === 0 ? (
            <p className="text-sm text-brand-textMuted">{t('homeProgramPlaceholder')}</p>
          ) : (
            <>
              <p className="text-sm text-brand-textMuted">
                {t('activeItemsCount', { count: activeItemsCount })}
              </p>
              <div className="flex gap-2" aria-label={t('weekDotsAria')}>
                {weekDots.map((d, i) => (
                  <div
                    key={i}
                    className="flex flex-col items-center gap-1"
                    aria-label={`${d.day} ${d.completed ? 'completed' : d.scheduled ? 'missed' : 'not scheduled'}`}
                  >
                    <span
                      className={`size-4 rounded-full border ${
                        d.completed
                          ? 'border-emerald-500 bg-emerald-500'
                          : d.scheduled
                            ? 'border-amber-400 bg-amber-100'
                            : 'border-brand-border bg-transparent'
                      }`}
                    />
                    <span className="text-[10px] text-brand-textMuted">{d.day}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button asChild variant="outline">
          <Link href="/patient/profile">
            <User className="me-2 size-4" />
            {t('profileTitle')}
          </Link>
        </Button>
      </div>
    </section>
  );
}
