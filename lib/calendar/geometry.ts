/**
 * Calendar geometry — pure time↔pixel mapping for the custom calendar
 * (Custom Calendar Phase 1). No React, no DOM; fully unit-tested in isolation.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ COORDINATE NOTE — the minute values here are LOCAL WALL-CLOCK minutes of   │
 * │ the day (0–1439), i.e. layout coordinates, NOT absolute-instant            │
 * │ comparisons. `minutesOfDay` reads the Date's browser-local hours/minutes,  │
 * │ matching how the prior react-big-calendar positioned events. This is       │
 * │ deliberately different from session-timing.ts, which compares absolute     │
 * │ instants and is timezone-independent. Do not "fix" this into tz math —     │
 * │ it would shift every card off its slot.                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

export const SLOT_MINUTES = 15;
export const DEFAULT_SLOT_HEIGHT_PX = 28;
export const DEFAULT_PX_PER_MINUTE = DEFAULT_SLOT_HEIGHT_PX / SLOT_MINUTES;
/** Floor so a very short (or zero-duration) appointment stays clickable. */
export const MIN_CARD_HEIGHT_PX = 18;

/** Visible vertical window, in minutes-of-day [startMinute, endMinute). */
export interface DayWindow {
  startMinute: number;
  endMinute: number;
}

/**
 * The visible window from the clinic's derived day hours, padded by `padHours`
 * on each side and clamped to [00:00, 24:00]. e.g. clinic 09:00–18:00, pad 1h
 * → 08:00–19:00.
 */
export function paddedWindow(minHour: number, maxHour: number, padHours = 1): DayWindow {
  const startMinute = Math.max(0, minHour - padHours) * 60;
  const endMinute = Math.min(24, maxHour + padHours) * 60;
  return { startMinute, endMinute };
}

/** Local wall-clock minutes since midnight (layout coordinate — see header). */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function windowMinutes(w: DayWindow): number {
  return w.endMinute - w.startMinute;
}

export function windowHeightPx(w: DayWindow, pxPerMinute = DEFAULT_PX_PER_MINUTE): number {
  return windowMinutes(w) * pxPerMinute;
}

/** Vertical offset (px) of a minute mark from the top of the window. */
export function minuteToY(
  minute: number,
  w: DayWindow,
  pxPerMinute = DEFAULT_PX_PER_MINUTE,
): number {
  return (minute - w.startMinute) * pxPerMinute;
}

/** Inverse of `minuteToY`, snapped to the nearest slot — for future drag math. */
export function yToMinute(
  y: number,
  w: DayWindow,
  pxPerMinute = DEFAULT_PX_PER_MINUTE,
  slot = SLOT_MINUTES,
): number {
  return snapMinuteToSlot(w.startMinute + y / pxPerMinute, slot);
}

export function snapMinuteToSlot(minute: number, slot = SLOT_MINUTES): number {
  return Math.round(minute / slot) * slot;
}

/**
 * Top + height (px) of an appointment card, clamped to the window so an
 * appointment that starts before / ends after the visible range is shown
 * clipped rather than overflowing. Enforces a minimum height.
 */
export function cardSpanPx(
  startMinute: number,
  endMinute: number,
  w: DayWindow,
  pxPerMinute = DEFAULT_PX_PER_MINUTE,
  minHeight = MIN_CARD_HEIGHT_PX,
): { topPx: number; heightPx: number } {
  const wh = windowHeightPx(w, pxPerMinute);
  const top = Math.min(Math.max(0, minuteToY(startMinute, w, pxPerMinute)), wh);
  const bottom = Math.min(wh, Math.max(0, minuteToY(endMinute, w, pxPerMinute)));
  const height = Math.max(minHeight, bottom - top);
  return { topPx: top, heightPx: height };
}

export interface SlotMark {
  minute: number;
  isHour: boolean;
}

/** Slot boundary marks across the window — hour marks flagged for labelling. */
export function slotMarks(w: DayWindow, slot = SLOT_MINUTES): SlotMark[] {
  const marks: SlotMark[] = [];
  for (let m = w.startMinute; m <= w.endMinute; m += slot) {
    marks.push({ minute: m, isHour: m % 60 === 0 });
  }
  return marks;
}
