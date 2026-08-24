'use client';

import './calendar.css';

import { ar as arLocale, enUS as enLocale } from 'date-fns/locale';
import { format as formatDateFns, getDay, parse, startOfWeek } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  Calendar,
  dateFnsLocalizer,
  Views,
  type Event as RbcEvent,
  type View,
} from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { CalendarAppointment } from '@/lib/appointments/queries';
import { fromClinicWall, toClinicWall } from '@/lib/time/clinic';
import { cn } from '@/lib/utils';

import { AppointmentTooltip } from './AppointmentTooltip';
import { CalendarToolbar } from './CalendarToolbar';
import { OTHER_LANE_ID, eventCardContent, eventsForView } from './eventsForView';
import { leaveBackgroundEvents } from './leaveEvents';
import { resourcesForView } from './resourcesForView';
import { CALENDAR_SLOTS_PER_GROUP, CALENDAR_STEP_MINUTES } from './slotConfig';

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
  /** Called when an event is dragged to a new slot/resource (reschedule). */
  onEventDrop?: (args: { appointmentId: string; start: Date; resourceId?: string }) => void;
  /** Called when an event's edge is dragged to change its DURATION (July #6).
   *  Start is unchanged; `end` is the new end time. */
  onEventResize?: (args: { appointmentId: string; start: Date; end: Date }) => void;
  /**
   * When true (Secretary / Admin / Doctor — Prompt 15 §2), events are
   * drag-to-reschedule and empty slots are click-to-book. When false the
   * calendar is read-only.
   */
  editable?: boolean;
}

// react-big-calendar drag-and-drop addon, wrapped once at module scope so the
// HOC isn't re-created on every render.
const DnDCalendar = withDragAndDrop<AppointmentEvent, CalendarResource>(Calendar);

interface AppointmentEvent extends RbcEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resourceId: string;
  status?: CalendarAppointment['status'];
  // Optional because backgroundEvents (leave overlays) share this type
  // but carry no underlying appointment.
  appointment?: CalendarAppointment;
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
  onEventDrop,
  onEventResize,
  editable = true,
}: SecretaryCalendarProps) {
  const locale = useLocale();
  const t = useTranslations('appointments');
  const tLeave = useTranslations('leave');
  const intlLocale = locale === 'ar' ? arLocale : enLocale;

  // View + date state — declared here (above the events memo) because the
  // fan-out is now view-aware (Option ②).
  //
  // TIMEZONE CONTRACT (Prompt 31 / P-8): everything handed to
  // react-big-calendar — events, `date`, min/max, getNow, slot Dates — lives
  // in CLINIC-WALL space (`toClinicWall`), so the grid reads in clinic time on
  // any machine. Everything leaving the component through interaction
  // callbacks is converted back to real instants with `fromClinicWall`.
  const [view, setView] = useState<View>(Views.DAY);
  const [date, setDate] = useState<Date>(() => toClinicWall(new Date()));

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

  // View-aware fan-out (Calendar overlap fix, Option ②): day view emits one
  // event per therapist (each lands in its resource column); week/month/agenda
  // emit one event per appointment so a multi-therapist session isn't
  // duplicated into the same combined day column. See ./eventsForView.
  const events = useMemo<AppointmentEvent[]>(
    () => eventsForView(appointments, view, locale),
    [appointments, view, locale],
  );

  // Leave overlays — rendered via react-big-calendar's `backgroundEvents`
  // prop. The conflict engine already blocks new bookings on these days
  // (`THERAPIST_ON_LEAVE` kind from Prompt 7); the background block is the
  // visual layer that makes the blocked region obvious. View-scoped in
  // Prompt 55 §1 (day lanes always; week only on single-clinician boards) —
  // see ./leaveEvents for the rules.
  const leaveBg = useMemo(
    () =>
      leaveBackgroundEvents(leaves, view, {
        onLeaveLabel: tLeave('calendar.onLeave'),
        hasResourceLanes: resources.length > 0,
      }),
    [leaves, view, resources.length, tLeave],
  );

  // A synthetic "Other" lane holds therapist-less appointments (STRETCHING —
  // July #8) in day view, but only when at least one exists so it doesn't
  // clutter the resource view otherwise.
  const hasOtherLane = useMemo(
    () => appointments.some((a) => a.therapists.length === 0),
    [appointments],
  );
  const rbcResources = useMemo<CalendarResource[]>(() => {
    const base = resources.map((r) => ({
      resourceId: r.id,
      resourceTitle: locale === 'ar' ? r.fullNameAr : r.fullNameEn,
    }));
    return hasOtherLane
      ? [...base, { resourceId: OTHER_LANE_ID, resourceTitle: t('otherLane') }]
      : base;
  }, [resources, locale, hasOtherLane, t]);

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
    // Hover-tooltip provider (Prompt 56): ~450ms show delay; skipDelayDuration
    // 0 means sweeping across many chips never rapid-fires tooltips (each
    // hover earns its own delay); disableHoverableContent keeps the floating
    // card pointer-transparent so it never blocks neighboring slots.
    <TooltipProvider delayDuration={450} skipDelayDuration={0} disableHoverableContent>
      <div className="space-y-4">
        <CalendarToolbar
          view={view}
          date={date}
          onViewChange={setView}
          onNavigate={(target) => setDate(target)}
          onToday={() => setDate(toClinicWall(new Date()))}
        />
        <div className={cn('h-[calc(100vh-16rem)] min-h-[640px]')}>
          <DnDCalendar
            localizer={localizer}
            events={events}
            // Resources (therapist lanes) only in DAY view — rbc can't lay them
            // out in week/month, which clipped + desynced the columns (Fix Prompt 4).
            resources={resourcesForView(view, rbcResources)}
            resourceIdAccessor={(r) => (r as CalendarResource).resourceId}
            resourceTitleAccessor={(r) => (r as CalendarResource).resourceTitle}
            startAccessor="start"
            endAccessor="end"
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            // Clinic "now" (current-time indicator + today highlight) — must
            // live in the same clinic-wall space as the events.
            getNow={() => toClinicWall(new Date())}
            views={['day', 'week', 'month', 'agenda']}
            // Lay concurrent events as equal-width, truly side-by-side columns
            // instead of rbc's default 'overlap' (which widens each event 1.7× so
            // they cover/clip each other — unreadable for 3+, worse in narrow week
            // columns). Calendar overlap fix, Option ①.
            dayLayoutAlgorithm="no-overlap"
            // 15-min interaction step grouped into whole-hour gridline/label
            // groups (July 31 item 1) — see ./slotConfig for the contract.
            step={CALENDAR_STEP_MINUTES}
            timeslots={CALENDAR_SLOTS_PER_GROUP}
            min={minTime}
            max={maxTime}
            selectable={editable}
            // Drag-to-reschedule is gated on `editable` and never applies to the
            // leave background overlays (which have no underlying appointment).
            draggableAccessor={(event) =>
              Boolean(editable && (event as AppointmentEvent).appointment)
            }
            // Edge-resize to change duration (July #6) — gated on the same
            // `editable` role flag as drag; never on the leave overlays.
            resizable={editable}
            resizableAccessor={(event) =>
              Boolean(editable && (event as AppointmentEvent).appointment)
            }
            onEventDrop={
              editable
                ? ({ event, start, resourceId }) => {
                    const appt = (event as AppointmentEvent).appointment;
                    if (!appt) return;
                    onEventDrop?.({
                      appointmentId: appt.id,
                      // Grid Dates are clinic-wall — back to a real instant
                      // before the reschedule action / conflict engine sees it.
                      start: fromClinicWall(start as Date),
                      resourceId: typeof resourceId === 'string' ? resourceId : undefined,
                    });
                  }
                : undefined
            }
            onEventResize={
              editable
                ? ({ event, start, end }) => {
                    const appt = (event as AppointmentEvent).appointment;
                    if (!appt) return;
                    onEventResize?.({
                      appointmentId: appt.id,
                      start: fromClinicWall(start as Date),
                      end: fromClinicWall(end as Date),
                    });
                  }
                : undefined
            }
            onSelectSlot={(s) => {
              onSelectSlot?.({
                start: fromClinicWall(s.start as Date),
                end: fromClinicWall(s.end as Date),
                resourceId: typeof s.resourceId === 'string' ? s.resourceId : undefined,
              });
            }}
            onSelectEvent={(e) => {
              const appt = (e as AppointmentEvent).appointment;
              if (appt) onSelectEvent?.(appt.id);
            }}
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
              // rbc-event-compact (Prompt 55 §2): ≤15-minute bookings drop to a
              // tighter padding so the name line stays legible at slot height.
              const compact =
                event.appointment && event.appointment.durationMinutes <= 15
                  ? ' rbc-event-compact'
                  : '';
              const base: { className: string; style?: React.CSSProperties } = {
                className: `rbc-event-status-${event.status ?? 'leave'}${compact}`,
              };
              if (event.status && TINT_STATUSES.has(event.status)) {
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
              // Slot Dates arrive in clinic-wall space (like the events), so
              // local getters read clinic hours on any machine.
              const h = date.getHours();
              const m = date.getMinutes();
              const classes: string[] = [];
              if (h >= 9 && h < 17) classes.push('rbc-peak-slot');
              if (h === 12 && m === 0) classes.push('rbc-noon');
              // Grey past slots so they read as unselectable (Fix 6C item 1). The
              // server is the source of truth (APPOINTMENT_IN_PAST); this is the
              // affordance. Wall-vs-wall comparison, same clinic space.
              if (date.getTime() < toClinicWall(new Date()).getTime())
                classes.push('rbc-past-slot');
              return classes.length > 0 ? { className: classes.join(' ') } : {};
            }}
            backgroundEvents={leaveBg as unknown as AppointmentEvent[]}
            components={{
              event: AppointmentEventCard,
              resourceHeader: TherapistResourceHeader,
            }}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function AppointmentEventCard({ event }: { event: AppointmentEvent }) {
  // react-big-calendar reuses `components.event` for backgroundEvents too,
  // which are leave overlays without an `appointment` field — render just
  // the title for those.
  if (!event.appointment) {
    return (
      <div className="flex h-full items-center px-2 text-[11px] font-medium opacity-80">
        <span className="truncate">{event.title}</span>
      </div>
    );
  }
  // Name-only card (owner request 24 Aug 2026, reversing PT-B3 item 3 and
  // restoring Prompt 55 §2): no time on the chip — the grid rows give the
  // hour; the name must read large and clear. Full details (incl. the exact
  // time) stay in the click-open side panel and the hover tooltip.
  const { primary, note } = eventCardContent(event);
  const tint = therapistTint(event.resourceId);
  return (
    // Prompt 56 — rich hover tooltip (desktop/fine-pointer only). Wraps the
    // card content INSIDE .rbc-event, so drag/click handlers on the event
    // element are untouched; leave overlays return above without a tooltip.
    <AppointmentTooltip appointment={event.appointment}>
      <div className="flex h-full flex-col gap-0.5 overflow-hidden">
        <div className="flex items-start gap-1.5">
          <span
            aria-hidden="true"
            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: tint.swatch }}
          />
          {/* Name + note ONLY (owner ruling 24 Aug: «بس الاسم يطلع في المربع
              والملاحظة») — the type badges and the Prompt 22 §4.4 overdue
              badge left the card; both remain in the hover tooltip and the
              side panel. The name WRAPS to two lines instead of truncating
              («لو ع سطرين»); shorter chips clip via overflow-hidden. */}
          <span className="line-clamp-2 min-w-0 flex-1 break-words text-[13px] font-semibold leading-tight">
            {primary}
          </span>
        </div>
        {note ? (
          <div className="truncate ps-3 text-[11px] leading-tight opacity-75">{note}</div>
        ) : null}
      </div>
    </AppointmentTooltip>
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
