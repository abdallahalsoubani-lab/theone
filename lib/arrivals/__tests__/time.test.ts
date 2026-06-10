import { describe, expect, it } from 'vitest';

import { clinicDayRange, tzOffsetMs } from '../time';

const AMMAN = 'Asia/Amman';

describe('tzOffsetMs', () => {
  it('reports Amman as UTC+3 (fixed, no DST since 2022)', () => {
    // A summer and a winter instant — both +3h in Jordan today.
    expect(tzOffsetMs(new Date('2026-07-01T00:00:00Z'), AMMAN)).toBe(3 * 3600_000);
    expect(tzOffsetMs(new Date('2026-01-01T00:00:00Z'), AMMAN)).toBe(3 * 3600_000);
  });
});

describe('clinicDayRange', () => {
  it('bounds the local day around an afternoon instant', () => {
    // 2026-06-10 13:00 Amman == 10:00Z. Local day = 10 Jun 00:00..11 Jun 00:00 local
    // → 09 Jun 21:00Z .. 10 Jun 21:00Z.
    const { start, end } = clinicDayRange(new Date('2026-06-10T10:00:00Z'), AMMAN);
    expect(start.toISOString()).toBe('2026-06-09T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-10T21:00:00.000Z');
  });

  it('keeps just-after-local-midnight on the correct local day', () => {
    // 2026-06-10 00:30 Amman == 2026-06-09 21:30Z. Still the 10 Jun local day.
    const { start, end } = clinicDayRange(new Date('2026-06-09T21:30:00Z'), AMMAN);
    expect(start.toISOString()).toBe('2026-06-09T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-10T21:00:00.000Z');
  });

  it('rolls to the previous local day just before local midnight (UTC-day trap)', () => {
    // 2026-06-09 23:30 Amman == 2026-06-09 20:30Z — a naive UTC day would say
    // "9 Jun" too, but the point is the local day must be 9 Jun, not 10.
    const { start } = clinicDayRange(new Date('2026-06-09T20:30:00Z'), AMMAN);
    expect(start.toISOString()).toBe('2026-06-08T21:00:00.000Z');
  });
});
