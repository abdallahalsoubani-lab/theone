import { describe, expect, it } from 'vitest';

import { customRange, presetRange } from '../range';
import { resolveReportRange } from '../params';

/** Suite runs TZ=UTC — clinic-TZ boundary math must not lean on the process
 *  zone (the Prompt-31 class of bug). */
const TZ = 'Asia/Amman';

describe('presetRange (clinic TZ)', () => {
  // Wednesday 2026-07-22 15:00 Amman.
  const NOW = new Date('2026-07-22T12:00:00Z');

  it('today = the clinic-local day, half-open', () => {
    const r = presetRange('today', NOW, TZ);
    expect(r.start.toISOString()).toBe('2026-07-21T21:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-07-22T21:00:00.000Z');
  });

  it('week starts on the clinic-local SUNDAY (Jordanian work week)', () => {
    const r = presetRange('week', NOW, TZ);
    expect(r.start.toISOString()).toBe('2026-07-18T21:00:00.000Z'); // Sun 19th 00:00 Amman
    expect(r.end.toISOString()).toBe('2026-07-25T21:00:00.000Z');
  });

  it('month = the clinic-local calendar month, incl. December rollover', () => {
    const r = presetRange('month', NOW, TZ);
    expect(r.start.toISOString()).toBe('2026-06-30T21:00:00.000Z'); // Jul 1 00:00 Amman
    expect(r.end.toISOString()).toBe('2026-07-31T21:00:00.000Z');
    const dec = presetRange('month', new Date('2026-12-15T12:00:00Z'), TZ);
    expect(dec.end.toISOString()).toBe('2026-12-31T21:00:00.000Z'); // Jan 1 00:00 Amman
  });

  it('a 23:30-Amman moment still belongs to ITS clinic day', () => {
    // 2026-07-22 23:30 Amman = 20:30Z.
    const r = presetRange('today', new Date('2026-07-22T20:30:00Z'), TZ);
    expect(r.start.toISOString()).toBe('2026-07-21T21:00:00.000Z');
  });
});

describe('customRange', () => {
  it('"to" is inclusive: 01→22 covers the whole 22nd', () => {
    const r = customRange('2026-07-01', '2026-07-22', TZ)!;
    expect(r.start.toISOString()).toBe('2026-06-30T21:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-07-22T21:00:00.000Z'); // 23rd 00:00 Amman
  });

  it('rejects malformed or inverted input', () => {
    expect(customRange('2026-7-1', '2026-07-22', TZ)).toBeNull();
    expect(customRange('2026-07-22', '2026-07-01', TZ)).toBeNull();
  });
});

describe('resolveReportRange', () => {
  const NOW = new Date('2026-07-22T12:00:00Z');

  it('custom from/to wins; bad input falls back to today', () => {
    const custom = resolveReportRange({ from: '2026-07-01', to: '2026-07-22' }, NOW, TZ);
    expect(custom.scope).toBe('custom');
    expect(custom.fromKey).toBe('2026-07-01');
    expect(custom.toKey).toBe('2026-07-22'); // display/export key = last included day
    const fallback = resolveReportRange({ from: 'garbage', to: 'x', scope: 'nope' }, NOW, TZ);
    expect(fallback.scope).toBe('today');
    expect(fallback.fromKey).toBe('2026-07-22');
  });
});
