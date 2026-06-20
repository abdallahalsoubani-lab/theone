'use client';

import { addDays } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import type { CalendarAppointment } from '@/lib/appointments/queries';
import { paddedWindow } from '@/lib/calendar/geometry';
import { formatDate } from '@/lib/format/date';

import { TherapistColumn, type ColumnAppointment } from './TherapistColumn';
import { TimeAxis } from './TimeAxis';

/**
 * Custom day view (Custom Calendar Phase 1) — STATIC, READ-ONLY, behind the
 * `NEXT_PUBLIC_CUSTOM_CALENDAR` flag. One column per active therapist, the
 * shared time axis, appointment cards positioned by the pure geometry + overlap
 * modules. No booking / edit / drag (Phases 2–3). RTL-first via logical CSS.
 */
interface Resource {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

interface Props {
  appointments: CalendarAppointment[];
  resources: Resource[];
  /** Derived clinic day hours; the view pads them ±1h. */
  minHour: number;
  maxHour: number;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function CustomDayView({ appointments, resources, minHour, maxHour }: Props) {
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const t = useTranslations('appointments');
  const [date, setDate] = useState<Date>(() => new Date());

  const window = useMemo(() => paddedWindow(minHour, maxHour), [minHour, maxHour]);

  // Appointments on the selected local day, grouped per therapist column. A
  // multi-therapist session appears in each of its therapists' columns
  // (matches the prior calendar's fan-out).
  const byTherapist = useMemo(() => {
    const map = new Map<string, ColumnAppointment[]>();
    for (const r of resources) map.set(r.id, []);
    for (const a of appointments) {
      if (!sameLocalDay(a.startsAt, date)) continue;
      const card: Omit<ColumnAppointment, 'therapistId'> = {
        id: a.id,
        patientNameEn: a.patientFullNameEn,
        patientNameAr: a.patientFullNameAr,
        startsAt: a.startsAt,
        endsAt: new Date(a.startsAt.getTime() + a.durationMinutes * 60_000),
        status: a.status,
        checkedIn: a.checkedInAt != null,
      };
      for (const th of a.therapists) {
        const lane = map.get(th.id);
        if (lane) lane.push({ ...card, therapistId: th.id });
      }
    }
    return map;
  }, [appointments, resources, date]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand-border bg-brand-surface p-3">
        <Button variant="outline" size="sm" onClick={() => setDate(new Date())}>
          {t('today')}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('previous')}
          onClick={() => setDate((d) => addDays(d, -1))}
        >
          <DirectionalIcon name="chevron-start" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('next')}
          onClick={() => setDate((d) => addDays(d, 1))}
        >
          <DirectionalIcon name="chevron-end" className="size-4" />
        </Button>
        <span className="ms-2 text-sm font-medium text-brand-navy">
          {formatDate(date, intlLocale)}
        </span>
      </div>

      <div className="overflow-auto rounded-xl border border-brand-border bg-brand-surface">
        <div className="flex min-h-[640px]">
          <div className="shrink-0">
            {/* Spacer aligning the axis under the column headers. */}
            <div className="h-[41px] border-b border-brand-border bg-[#eef1f6]" />
            <TimeAxis window={window} locale={intlLocale} />
          </div>
          {resources.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-brand-textMuted">
              {t('noActiveTherapists')}
            </div>
          ) : (
            resources.map((r) => (
              <TherapistColumn
                key={r.id}
                therapistId={r.id}
                therapistName={intlLocale === 'ar' ? r.fullNameAr : r.fullNameEn}
                window={window}
                appointments={byTherapist.get(r.id) ?? []}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
