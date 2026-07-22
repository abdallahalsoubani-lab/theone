'use client';

import { useLocale, useTranslations } from 'next-intl';
import { addDays, addMonths, addWeeks, subDays, subMonths, subWeeks } from 'date-fns';
import { Views, type View } from 'react-big-calendar';

import { Button } from '@/components/ui/button';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { formatDate } from '@/lib/format/date';
import { fromClinicWall } from '@/lib/time/clinic';

interface Props {
  view: View;
  /** CLINIC-WALL date (SecretaryCalendar's grid space — Prompt 31). */
  date: Date;
  onViewChange: (view: View) => void;
  onNavigate: (date: Date) => void;
  onToday: () => void;
}

/**
 * Calendar toolbar — view switcher (Day / Week / Month / Agenda), date
 * navigator, today button. RTL-aware via DirectionalIcon.
 */
export function CalendarToolbar({ view, date, onViewChange, onNavigate, onToday }: Props) {
  const t = useTranslations('appointments');
  const locale = useLocale();
  const intlLocale = locale === 'ar' ? 'ar' : 'en';

  const step = (direction: 1 | -1) => {
    if (view === Views.DAY) {
      onNavigate(direction === 1 ? addDays(date, 1) : subDays(date, 1));
    } else if (view === Views.WEEK || view === Views.WORK_WEEK) {
      onNavigate(direction === 1 ? addWeeks(date, 1) : subWeeks(date, 1));
    } else if (view === Views.MONTH) {
      onNavigate(direction === 1 ? addMonths(date, 1) : subMonths(date, 1));
    } else {
      onNavigate(direction === 1 ? addDays(date, 7) : subDays(date, 7));
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-border bg-brand-surface p-3">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={onToday}>
          {t('today')}
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('previous')} onClick={() => step(-1)}>
          <DirectionalIcon name="chevron-start" className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('next')} onClick={() => step(1)}>
          <DirectionalIcon name="chevron-end" className="size-4" />
        </Button>
        <span className="ms-2 text-sm font-medium text-brand-navy">
          {/* `date` is clinic-WALL; formatDate pins Asia/Amman, so feeding it
              the wall Date directly double-shifts on a non-Amman machine —
              on the UTC prod server the SSR label was one day ahead, which
              was the calendar's hydration mismatch (Prompt 34). Convert the
              wall back to the true instant first: identical text on server
              and client, exact historical rendering preserved. */}
          {formatDate(fromClinicWall(date), intlLocale)}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {(
          [
            { v: Views.DAY, label: t('viewDay') },
            { v: Views.WEEK, label: t('viewWeek') },
            { v: Views.MONTH, label: t('viewMonth') },
            { v: Views.AGENDA, label: t('viewAgenda') },
          ] as const
        ).map(({ v, label }) => (
          <Button
            key={v}
            type="button"
            variant={view === v ? 'default' : 'outline'}
            size="sm"
            onClick={() => onViewChange(v)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
