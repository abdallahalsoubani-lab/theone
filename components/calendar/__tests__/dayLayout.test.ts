import { describe, expect, it } from 'vitest';

import {
  DAY_LAYOUT_STORAGE_KEY,
  DEFAULT_DAY_LAYOUT,
  parseDayLayout,
  readStoredDayLayout,
  usesResourceLanes,
} from '../dayLayout';

/** P63 — the pure half of the day layout switch. */
describe('dayLayout', () => {
  it('defaults to lanes (the Prompt 7 resource columns)', () => {
    expect(DEFAULT_DAY_LAYOUT).toBe('lanes');
    expect(parseDayLayout(null)).toBe('lanes');
    expect(parseDayLayout(undefined)).toBe('lanes');
    expect(parseDayLayout('garbage')).toBe('lanes');
    expect(parseDayLayout('lanes')).toBe('lanes');
  });

  it('only the exact stored token selects the merged layout', () => {
    expect(parseDayLayout('merged')).toBe('merged');
    expect(parseDayLayout('MERGED')).toBe('lanes');
  });

  it('lanes are a DAY + lanes property — never week/month/agenda, never the merged day', () => {
    expect(usesResourceLanes('day', 'lanes')).toBe(true);
    expect(usesResourceLanes('day', 'merged')).toBe(false);
    expect(usesResourceLanes('week', 'lanes')).toBe(false);
    expect(usesResourceLanes('month', 'lanes')).toBe(false);
    expect(usesResourceLanes('agenda', 'lanes')).toBe(false);
  });

  it('reading without a window (SSR) yields the default — no throw', () => {
    expect(readStoredDayLayout()).toBe('lanes');
    expect(DAY_LAYOUT_STORAGE_KEY).toBe('theone.calendar.dayLayout');
  });
});
