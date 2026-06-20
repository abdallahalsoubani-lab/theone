'use client';

import { useMemo } from 'react';

import {
  cardSpanPx,
  DEFAULT_PX_PER_MINUTE,
  minutesOfDay,
  minuteToY,
  slotMarks,
  windowHeightPx,
  type DayWindow,
} from '@/lib/calendar/geometry';
import { layoutColumn, type LayoutInput } from '@/lib/calendar/layout';
import { therapistTint } from '@/lib/calendar/appearance';

import { AppointmentCard, type CardModel } from './AppointmentCard';

/**
 * One therapist's lane in the day view (Custom Calendar Phase 1): a header,
 * the 15-minute grid background, and the appointment cards laid out
 * side-by-side via the pure overlap algorithm. Read-only this phase.
 */
export interface ColumnAppointment extends CardModel {
  therapistId: string;
}

interface Props {
  therapistId: string;
  therapistName: string;
  window: DayWindow;
  appointments: ColumnAppointment[];
}

export function TherapistColumn({ therapistId, therapistName, window, appointments }: Props) {
  const height = windowHeightPx(window);
  const tint = therapistTint(therapistId);

  const boxes = useMemo(() => {
    const inputs: LayoutInput[] = appointments.map((a) => ({
      id: a.id,
      startMinute: minutesOfDay(a.startsAt),
      endMinute: minutesOfDay(a.endsAt),
    }));
    return layoutColumn(inputs);
  }, [appointments]);

  const marks = slotMarks(window);

  return (
    <div className="relative min-w-[8rem] flex-1 border-e border-brand-border last:border-e-0">
      <div className="flex items-center justify-center gap-1.5 border-b border-brand-border bg-[#eef1f6] px-2 py-2 text-sm font-medium text-brand-navy">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tint.swatch }} />
        <span className="truncate">{therapistName}</span>
      </div>

      {/* Grid + cards share one relative box of the window's height. */}
      <div className="relative overflow-x-auto" style={{ blockSize: `${height}px` }}>
        {/* Grid lines */}
        {marks.map((mark) => (
          <div
            key={mark.minute}
            className={
              mark.isHour
                ? 'absolute inset-x-0 border-t border-brand-border'
                : 'absolute inset-x-0 border-t border-brand-border/40'
            }
            style={{
              insetBlockStart: `${minuteToY(mark.minute, window, DEFAULT_PX_PER_MINUTE)}px`,
            }}
          />
        ))}
        {/* Cards */}
        {appointments.map((appt, i) => {
          const box = boxes[i];
          if (!box) return null;
          const { topPx, heightPx } = cardSpanPx(
            minutesOfDay(appt.startsAt),
            minutesOfDay(appt.endsAt),
            window,
          );
          return (
            <AppointmentCard
              key={appt.id}
              card={appt}
              box={box}
              topPx={topPx}
              heightPx={heightPx}
              tint={tint}
            />
          );
        })}
      </div>
    </div>
  );
}
