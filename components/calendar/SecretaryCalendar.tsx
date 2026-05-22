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
 * Per-therapist tint palette. Each entry is a soft-fill / strong-border
 * pair designed to remain readable behind the dark navy event text.
 *
 * Hues are spaced evenly around the color wheel from the brand-blue base
 * so two adjacent therapists never read as the same color, while keeping
 * the same saturation + lightness curve so no card visually "shouts"
 * over its neighbour. This is data-viz coloration (not a brand token) —
 * it sits next to the brand palette without replacing it.
 */
const THERAPIST_TINTS: ReadonlyArray<{ bg: string; border: string; swatch: string }> = [
  { bg: 'rgba(27, 73, 130, 0.12)', border: 'rgba(27, 73, 130, 0.55)', swatch: '#1b4982' }, //  brand blue
  { bg: 'rgba(61, 192, 217, 0.16)', border: 'rgba(61, 192, 217, 0.60)', swatch: '#3dc0d9' }, // brand cyan
  { bg: 'rgba(30, 95, 88, 0.14)', border: 'rgba(30, 95, 88, 0.55)', swatch: '#1e5f58' }, //   brand teal
  { bg: 'rgba(124, 58, 237, 0.12)', border: 'rgba(124, 58, 237, 0.50)', swatch: '#7c3aed' }, // violet
  { bg: 'rgba(217, 119, 6, 0.14)', border: 'rgba(217, 119, 6, 0.55)', swatch: '#d97706' }, //   amber
  { bg: 'rgba(219, 39, 119, 0.12)', border: 'rgba(219, 39, 119, 0.50)', swatch: '#db2777' }, // pink
];

/** Stable hash → palette index. Same therapist id always lands on the
 *  same tint across renders, sessions, and browser reloads. */
function therapistTint(id: string): (typeof THERAPIST_TINTS)[number] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return THERAPIST_TINTS[Math.abs(hash) % THERAPIST_TINTS.length]!;
}

/** Statuses that should keep the therapist tint. Terminal statuses
 *  (cancelled, completed, no-show, in-progress) carry their own
 *  meaning-bearing color from calendar.css and must override. */
const TINT_STATUSES = new Set(['SCHEDULED', 'CONFIRMED']);

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
          eventPropGetter={(event) => {
            const base: { className: string; style?: React.CSSProperties } = {
              className: `rbc-event-status-${event.status}`,
            };
            if (TINT_STATUSES.has(event.status)) {
              const tint = therapistTint(event.resourceId);
              base.style = {
                backgroundColor: tint.bg,
                borderColor: tint.border,
              };
            }
            return base;
          }}
          slotPropGetter={(date: Date) => {
            // Per-slot styling hints — react-big-calendar invokes this
            // for every 15-minute cell with the slot's start Date.
            //
            //   - rbc-peak-slot: 09:00–17:00 (the clinic's working core).
            //     calendar.css lifts these to pure white against an
            //     off-peak off-white background.
            //   - rbc-noon: the 12:00 slot — picks up a heavier top
            //     border as a visual AM/PM divider.
            //
            // slotGroupPropGetter would be the conceptually cleaner
            // place for the noon hint, but the library's runtime invokes
            // it with zero args (the slot date isn't available there).
            const h = date.getHours();
            const m = date.getMinutes();
            const classes: string[] = [];
            if (h >= 9 && h < 17) classes.push('rbc-peak-slot');
            if (h === 12 && m === 0) classes.push('rbc-noon');
            return classes.length > 0 ? { className: classes.join(' ') } : {};
          }}
          backgroundEvents={leaveBackgroundEvents as unknown as AppointmentEvent[]}
          components={{
            event: AppointmentEventCard,
            resourceHeader: TherapistResourceHeader,
          }}
        />
      </div>
    </div>
  );
}

function AppointmentEventCard({ event }: { event: AppointmentEvent }) {
  const locale = useLocale();
  const startLabel = `${pad(event.start.getHours())}:${pad(event.start.getMinutes())}`;
  const endLabel = `${pad(event.end.getHours())}:${pad(event.end.getMinutes())}`;
  const therapist =
    locale === 'ar' ? event.appointment.therapistFullNameAr : event.appointment.therapistFullNameEn;
  const tint = therapistTint(event.resourceId);
  return (
    <div className="flex h-full flex-col gap-0.5 overflow-hidden">
      <div className="flex items-start gap-1.5">
        <span
          aria-hidden="true"
          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: tint.swatch }}
        />
        <span className="truncate text-[13px] font-semibold leading-tight">{event.title}</span>
      </div>
      <div className="ps-3 text-[11px] font-medium tabular-nums leading-tight opacity-80">
        {startLabel}–{endLabel}
      </div>
      {/* Therapist name kept tiny + truncated for non-day views where the
       * resource column header isn't visible. In day view it's redundant
       * but harmless because the row is bounded by the card height. */}
      <div className="truncate ps-3 text-[10px] opacity-70">{therapist}</div>
    </div>
  );
}

/**
 * Custom resource-column header. Renders a colored swatch alongside the
 * therapist name so the per-therapist tint used on the events is
 * obvious from the column heading without legend or hover.
 */
function TherapistResourceHeader({
  label,
  resource,
}: {
  // react-big-calendar passes `label` as the same type it accepts for
  // event titles (ReactNode), and the resource is whatever shape the
  // localizer was wired with — keep it loose at the boundary, then
  // narrow internally.
  label: React.ReactNode;
  resource: CalendarResource;
}) {
  const tint = therapistTint(resource.resourceId);
  return (
    <div className="therapist-header">
      <span
        aria-hidden="true"
        className="therapist-header__swatch"
        style={{ backgroundColor: tint.swatch }}
      />
      <span>{label}</span>
    </div>
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
