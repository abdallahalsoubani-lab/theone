import { describe, expect, it } from 'vitest';

import { resolveCustomCalendar } from '../flag';

describe('resolveCustomCalendar', () => {
  it('?calendar=custom forces the custom calendar regardless of env', () => {
    expect(resolveCustomCalendar('custom', false)).toBe(true);
  });
  it('?calendar=rbc forces rbc regardless of env', () => {
    expect(resolveCustomCalendar('rbc', true)).toBe(false);
  });
  it('falls back to the env default when no param', () => {
    expect(resolveCustomCalendar(undefined, true)).toBe(true);
    expect(resolveCustomCalendar(undefined, false)).toBe(false);
  });
  it('ignores unrecognised param values', () => {
    expect(resolveCustomCalendar('maybe', false)).toBe(false);
  });
  it('takes the first value when the param repeats', () => {
    expect(resolveCustomCalendar(['custom', 'rbc'], false)).toBe(true);
  });
});
