'use client';

import {
  DEFAULT_PX_PER_MINUTE,
  minuteToY,
  slotMarks,
  windowHeightPx,
  type DayWindow,
} from '@/lib/calendar/geometry';

/**
 * The hour/▸slot axis down the inline-start edge of the day view (Custom
 * Calendar Phase 1). Sits first in the inline flow, so it lands on the left in
 * `/en` and the right in `/ar` automatically (logical layout, no overrides).
 */
function label(minute: number, locale: 'en' | 'ar'): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(locale === 'ar' ? 'ar-JO' : 'en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function TimeAxis({ window, locale }: { window: DayWindow; locale: 'en' | 'ar' }) {
  const height = windowHeightPx(window);
  const marks = slotMarks(window).filter((m) => m.isHour);
  return (
    <div
      className="relative w-16 shrink-0 border-e border-brand-border bg-brand-bg"
      style={{ blockSize: `${height}px` }}
      aria-hidden
    >
      {marks.map((mark) => (
        <div
          key={mark.minute}
          className="absolute end-1 -translate-y-1/2 text-[0.7rem] font-medium tabular-nums text-brand-navy"
          style={{ insetBlockStart: `${minuteToY(mark.minute, window, DEFAULT_PX_PER_MINUTE)}px` }}
        >
          {label(mark.minute, locale)}
        </div>
      ))}
    </div>
  );
}
