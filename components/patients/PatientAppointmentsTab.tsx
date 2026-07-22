import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import type { PatientFileAppointment } from '@/lib/appointments/queries';
import { formatDate, formatTime } from '@/lib/format/date';

/**
 * Patient-file "Appointments" tab (Prompt 33 — NI-2). The tab trigger has
 * existed since Prompt 6 but its content was a never-replaced placeholder, so
 * every role saw an empty pane. Upcoming first (soonest first), then past
 * (newest first). Pure display: no phone, no links out of the viewer's
 * interface — safe for every role that can open the file.
 */

const STATUS_KEY: Record<PatientFileAppointment['status'], string> = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'inProgress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'noShow',
};

const TYPE_KEY: Record<string, string> = {
  SESSION: 'typeSession',
  STRETCHING: 'typeStretching',
  EVENT: 'typeEvent',
  GROUP: 'typeGroup',
};

export function PatientAppointmentsTab({
  appointments,
  locale,
  now = new Date(),
}: {
  appointments: PatientFileAppointment[];
  locale: 'en' | 'ar';
  /** Injected in tests; defaults to the render instant. */
  now?: Date;
}) {
  const t = useTranslations('patients.appointmentsTab');
  const tStatus = useTranslations('appointments.status');
  const tForm = useTranslations('appointments.form');

  const upcoming = appointments
    .filter((a) => a.startsAt.getTime() + a.durationMinutes * 60_000 >= now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = appointments.filter(
    (a) => a.startsAt.getTime() + a.durationMinutes * 60_000 < now.getTime(),
  );

  if (appointments.length === 0) {
    return (
      <p className="rounded-md border border-brand-border bg-brand-bg p-6 text-center text-sm text-brand-textMuted">
        {t('empty')}
      </p>
    );
  }

  const section = (heading: string, rows: PatientFileAppointment[]) =>
    rows.length === 0 ? null : (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-brand-navy">{heading}</h3>
        <div className="overflow-x-auto rounded-md border border-brand-border">
          <table className="w-full text-sm">
            <thead className="bg-brand-bg text-start text-xs text-brand-textMuted">
              <tr>
                <th className="p-2 text-start font-medium">{t('colWhen')}</th>
                <th className="p-2 text-start font-medium">{t('colType')}</th>
                <th className="p-2 text-start font-medium">{t('colTherapists')}</th>
                <th className="p-2 text-start font-medium">{t('colRoom')}</th>
                <th className="p-2 text-start font-medium">{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-brand-border">
                  <td className="whitespace-nowrap p-2 tabular-nums">
                    {formatDate(a.startsAt, locale)} · {formatTime(a.startsAt, locale)}
                  </td>
                  <td className="p-2">
                    {tForm(TYPE_KEY[a.appointmentType] ?? 'typeSession')}
                    {a.title ? ` — ${a.title}` : ''}
                  </td>
                  <td className="p-2">
                    {a.therapists
                      .map((th) => (locale === 'ar' ? th.fullNameAr : th.fullNameEn))
                      .join(locale === 'ar' ? '، ' : ', ') || '—'}
                  </td>
                  <td className="p-2">{a.roomName ?? '—'}</td>
                  <td className="p-2">
                    <Badge variant="outline">{tStatus(STATUS_KEY[a.status])}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );

  return (
    <div className="space-y-6">
      {section(t('upcomingHeading'), upcoming)}
      {section(t('pastHeading'), past)}
    </div>
  );
}
