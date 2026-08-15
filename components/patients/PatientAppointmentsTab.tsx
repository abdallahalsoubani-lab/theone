'use client';

import { CalendarClock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  RescheduleAppointmentModal,
  type RescheduleTarget,
} from '@/components/appointments/RescheduleAppointmentModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PatientFileAppointment } from '@/lib/appointments/queries';
import { formatDate, formatTime } from '@/lib/format/date';

/**
 * Patient-file "Appointments" tab (Prompt 33 — NI-2; reschedule action in
 * Prompt 48). Upcoming first (soonest first), then past (newest first). No
 * phone, no links out of the viewer's interface — safe for every role that
 * can open the file.
 *
 * Reschedule control (Prompt 48): rows in the UPCOMING section that are
 * still SCHEDULED/CONFIRMED get a "تعديل الموعد" action when the page passes
 * `canReschedule` (secretary/admin only since Prompt 45 row 3 — the doctor's
 * P15 parity was reversed; doctor + therapist pages stay read-only). Past
 * rows are excluded
 * by the time partition; cancelled/completed rows inside "upcoming" are
 * excluded by status. One shared modal — identical funnel to the calendar.
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
  patientId = null,
  canReschedule = false,
  now = new Date(),
}: {
  appointments: PatientFileAppointment[];
  locale: 'en' | 'ar';
  /** The file's subject — feeds the reschedule modal's conflict preview. */
  patientId?: string | null;
  /** Secretary/Admin pages pass true; doctor + therapist stay read-only
   *  (Prompt 45 row 3). */
  canReschedule?: boolean;
  /** Injected in tests; defaults to the render instant. */
  now?: Date;
}) {
  const t = useTranslations('patients.appointmentsTab');
  const tStatus = useTranslations('appointments.status');
  const tForm = useTranslations('appointments.form');
  const tActions = useTranslations('appointments.reschedule');
  const [target, setTarget] = useState<RescheduleTarget | null>(null);

  const reschedulable = (a: PatientFileAppointment) =>
    canReschedule && (a.status === 'SCHEDULED' || a.status === 'CONFIRMED');

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

  const section = (heading: string, rows: PatientFileAppointment[], withActions = false) =>
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
                {withActions && canReschedule ? <th className="p-2" /> : null}
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
                  {withActions && canReschedule ? (
                    <td className="p-2 text-end">
                      {reschedulable(a) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setTarget({
                              id: a.id,
                              startsAt: a.startsAt,
                              durationMinutes: a.durationMinutes,
                              patientId,
                              therapistIds: a.therapists.map((th) => th.id),
                            })
                          }
                        >
                          <CalendarClock className="me-1.5 size-3.5" />
                          {tActions('action')}
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );

  return (
    <div className="space-y-6">
      {section(t('upcomingHeading'), upcoming, true)}
      {section(t('pastHeading'), past)}
      <RescheduleAppointmentModal
        open={target !== null}
        target={target}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
