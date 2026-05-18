'use client';

import './calendar.css';

import { ar as arLocale, enUS as enLocale } from 'date-fns/locale';
import { addMinutes, format as formatDateFns, getDay, parse, startOfWeek } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  Calendar,
  dateFnsLocalizer,
  Views,
  type Event as RbcEvent,
  type View,
} from 'react-big-calendar';

import type { CalendarAppointment } from '@/lib/appointments/queries';
import { cn } from '@/lib/utils';

import { CalendarToolbar } from './CalendarToolbar';

interface CalendarResource {
  resourceId: string;
  resourceTitle: string;
}

export interface SecretaryCalendarProps {
  appointments: CalendarAppointment[];
  /** Active therapists / doctors — rendered as resource columns. */
  resources: Array<{ id: string; fullNameEn: string; fullNameAr: string }>;
  /** Approved leaves overlapping the visible range (Prompt 11 §4.1.5).
   *  Rendered as muted background blocks on the therapist's column. */
  leaves?: Array<{ id: string; userId: string; startDate: Date; endDate: Date }>;
  /** Min hour (24h, 0–23) — derived from ClinicSettings.businessHours earliest open. */
  minHour: number;
  /** Max hour (24h) — derived from latest close. */
  maxHour: number;
  /** Called when an empty slot is clicked. Commit 5 wires this to the create modal. */
  onSelectSlot?: (slot: { start: Date; end: Date; resourceId?: string }) => void;
  /** Called when an existing event is clicked. Commit 5 wires this to the side panel. */
  onSelectEvent?: (appointmentId: string) => void;
  /** Called when an event is dragged to a new slot/resource. Commit 5 wires this. */
  onEventDrop?: (args: { appointmentId: string; start: Date; resourceId?: string }) => void;
}

interface AppointmentEvent extends RbcEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resourceId: string;
  status: CalendarAppointment['status'];
  appointment: CalendarAppointment;
}

/**
 * Secretary's primary calendar view (Prompt 7 §4.4).
 *
 * react-big-calendar + custom event renderer + brand-themed CSS overrides
 * (calendar.css). Resource columns = active therapists/doctors. Day/Week/
 * Month views; drag-and-drop wiring is added in commit 5 via withDragAndDrop
 * — this commit lands the structural shell + click handlers.
 *
 * RTL is handled via [dir='rtl'] selectors in calendar.css plus the locale-
 * aware date-fns localizer below. Test by visiting /ar/secretary/calendar.
 */
export function SecretaryCalendar({
  appointments,
  resources,
  leaves,
  minHour,
  maxHour,
  onSelectSlot,
  onSelectEvent,
  onEventDrop: _onEventDrop,
}: SecretaryCalendarProps) {
  const locale = useLocale();
  const t = useTranslations('appointments');
  const tLeave = useTranslations('leave');
  const intlLocale = locale === 'ar' ? arLocale : enLocale;

  const localizer = useMemo(
    () =>
      dateFnsLocalizer({
        format: formatDateFns,
        parse,
        startOfWeek: () => startOfWeek(new Date(), { locale: intlLocale }),
        getDay,
        locales: { ar: arLocale, 'en-US': enLocale },
      }),
    [intlLocale],
  );

  const events = useMemo<AppointmentEvent[]>(
    () =>
      appointments.map((a) => ({
        id: a.id,
        title: locale === 'ar' ? a.patientFullNameAr : a.patientFullNameEn,
        start: a.startsAt,
        end: addMinutes(a.startsAt, a.durationMinutes),
        resourceId: a.therapistId,
        status: a.status,
        appointment: a,
      })),
    [appointments, locale],
  );

  // Leave overlays — rendered via react-big-calendar's `backgroundEvents`
  // prop. The conflict engine already blocks new bookings on these days
  // (`THERAPIST_ON_LEAVE` kind from Prompt 7); the background block is
  // the visual layer that makes the blocked region obvious.
  const leaveBackgroundEvents = useMemo(() => {
    if (!leaves || leaves.length === 0) return [];
    const onLeaveLabel = tLeave('calendar.onLeave');
    return leaves.map((l) => {
      const start = new Date(l.startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(l.endDate);
      end.setHours(23, 59, 59, 999);
      return {
        id: `leave-${l.id}`,
        title: onLeaveLabel,
        start,
        end,
        resourceId: l.userId,
        leave: true as const,
      };
    });
  }, [leaves, tLeave]);

  const rbcResources = useMemo<CalendarResource[]>(
    () =>
      resources.map((r) => ({
        resourceId: r.id,
        resourceTitle: locale === 'ar' ? r.fullNameAr : r.fullNameEn,
      })),
    [resources, locale],
  );

  const [view, setView] = useState<View>(Views.DAY);
  const [date, setDate] = useState<Date>(new Date());

  const minTime = useMemo(() => {
    const d = new Date(date);
    d.setHours(minHour, 0, 0, 0);
    return d;
  }, [date, minHour]);

  const maxTime = useMemo(() => {
    const d = new Date(date);
    d.setHours(maxHour, 0, 0, 0);
    return d;
  }, [date, maxHour]);

  return (
    <div className="space-y-4">
      <CalendarToolbar
        view={view}
        date={date}
        onViewChange={setView}
        onNavigate={(target) => setDate(target)}
        onToday={() => setDate(new Date())}
      />
      <div className={cn('h-[calc(100vh-16rem)] min-h-[640px]')}>
        <Calendar<AppointmentEvent, CalendarResource>
          localizer={localizer}
          events={events}
          resources={rbcResources.length > 0 ? rbcResources : undefined}
          resourceIdAccessor={(r) => (r as CalendarResource).resourceId}
          resourceTitleAccessor={(r) => (r as CalendarResource).resourceTitle}
          startAccessor="start"
          endAccessor="end"
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          views={['day', 'week', 'month', 'agenda']}
          step={15}
          timeslots={2}
          min={minTime}
          max={maxTime}
          selectable
          onSelectSlot={(s) => {
            onSelectSlot?.({
              start: s.start as Date,
              end: s.end as Date,
              resourceId: typeof s.resourceId === 'string' ? s.resourceId : undefined,
            });
          }}
          onSelectEvent={(e) => onSelectEvent?.(e.id)}
          messages={{
            allDay: t('allDay'),
            previous: t('previous'),
            next: t('next'),
            today: t('today'),
            month: t('viewMonth'),
            week: t('viewWeek'),
            day: t('viewDay'),
            agenda: t('viewAgenda'),
            noEventsInRange: t('noEventsInRange'),
            showMore: (count) => t('showMore', { count }),
          }}
          eventPropGetter={(event) => ({
            className: `rbc-event-status-${event.status}`,
          })}
          backgroundEvents={leaveBackgroundEvents as unknown as AppointmentEvent[]}
          components={{
            event: AppointmentEventCard,
          }}
        />
      </div>
    </div>
  );
}

function AppointmentEventCard({ event }: { event: AppointmentEvent }) {
  const locale = useLocale();
  const minuteLabel = `${pad(event.start.getHours())}:${pad(event.start.getMinutes())}`;
  const therapist =
    locale === 'ar' ? event.appointment.therapistFullNameAr : event.appointment.therapistFullNameEn;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium">{event.title}</span>
        <span className="text-[10px] opacity-70">{minuteLabel}</span>
      </div>
      <div className="truncate text-[10px] opacity-75">{therapist}</div>
    </div>
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
