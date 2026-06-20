import { describe, expect, it } from 'vitest';

import {
  cardSpanPx,
  DEFAULT_PX_PER_MINUTE,
  MIN_CARD_HEIGHT_PX,
  minutesOfDay,
  minuteToY,
  paddedWindow,
  slotMarks,
  snapMinuteToSlot,
  windowHeightPx,
  yToMinute,
  type DayWindow,
} from '../geometry';

const W: DayWindow = paddedWindow(9, 18); // clinic 09:00–18:00 → 08:00–19:00

describe('paddedWindow', () => {
  it('pads the derived clinic hours by ±1h', () => {
    expect(paddedWindow(9, 18)).toEqual({ startMinute: 480, endMinute: 1140 }); // 08:00–19:00
  });
  it('clamps to [00:00, 24:00]', () => {
    expect(paddedWindow(0, 24)).toEqual({ startMinute: 0, endMinute: 1440 });
    expect(paddedWindow(0, 23, 2)).toEqual({ startMinute: 0, endMinute: 1440 });
  });
});

describe('minutesOfDay', () => {
  it('reads local wall-clock minutes (layout coordinate)', () => {
    const d = new Date(2026, 5, 1, 9, 30, 0); // local 09:30
    expect(minutesOfDay(d)).toBe(570);
  });
});

describe('minuteToY / windowHeightPx', () => {
  it('window start maps to y=0', () => {
    expect(minuteToY(480, W)).toBe(0);
  });
  it('one slot down = SLOT height', () => {
    expect(minuteToY(495, W)).toBeCloseTo(15 * DEFAULT_PX_PER_MINUTE, 9);
  });
  it('total height = window minutes × px/min', () => {
    expect(windowHeightPx(W)).toBeCloseTo(660 * DEFAULT_PX_PER_MINUTE, 9);
  });
});

describe('snapMinuteToSlot / yToMinute', () => {
  it('snaps to the nearest 15-min slot', () => {
    expect(snapMinuteToSlot(607)).toBe(600); // 10:07 → 10:00
    expect(snapMinuteToSlot(608)).toBe(615); // 10:08 → 10:15
  });
  it('yToMinute inverts minuteToY at slot boundaries', () => {
    const y = minuteToY(600, W); // 10:00
    expect(yToMinute(y, W)).toBe(600);
  });
});

describe('cardSpanPx', () => {
  it('positions a normal in-window card', () => {
    const { topPx, heightPx } = cardSpanPx(600, 630, W); // 10:00–10:30
    expect(topPx).toBeCloseTo(120 * DEFAULT_PX_PER_MINUTE, 9);
    expect(heightPx).toBeCloseTo(30 * DEFAULT_PX_PER_MINUTE, 9);
  });
  it('enforces a minimum height for very short / zero-duration cards', () => {
    const { heightPx } = cardSpanPx(600, 600, W);
    expect(heightPx).toBe(MIN_CARD_HEIGHT_PX);
  });
  it('clamps a card starting before the window to the top', () => {
    const { topPx } = cardSpanPx(420, 540, W); // 07:00–09:00, window starts 08:00
    expect(topPx).toBe(0);
  });
  it('clamps a card ending after the window to the bottom', () => {
    const wh = windowHeightPx(W);
    const { topPx, heightPx } = cardSpanPx(1110, 1230, W); // 18:30–20:30, window ends 19:00
    expect(topPx + heightPx).toBeLessThanOrEqual(wh + 1e-9);
  });
});

describe('slotMarks', () => {
  it('produces a mark per slot with hour flags', () => {
    const marks = slotMarks(W);
    expect(marks[0]).toEqual({ minute: 480, isHour: true }); // 08:00
    expect(marks[1]).toEqual({ minute: 495, isHour: false }); // 08:15
    expect(marks.at(-1)).toEqual({ minute: 1140, isHour: true }); // 19:00
    expect(marks.filter((m) => m.isHour)).toHaveLength(12); // 08:00..19:00 inclusive
  });
});
