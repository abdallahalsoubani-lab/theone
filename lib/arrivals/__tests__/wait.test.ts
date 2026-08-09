import { describe, expect, it } from 'vitest';

import { kioskWait, minutesUntil } from '../wait';

/**
 * PT-B5 item 3 — the kiosk's "your turn in ~N minutes".
 *
 * It used to echo the clinic-wide `currentDelayMinutes` setting, so it was the
 * same number for every patient and never looked at the appointment at all.
 * The three cases QA documented are the first three tests below, using their
 * exact times.
 *
 * The clinic runs on Asia/Amman; these instants are written in UTC (+3), and
 * the wait itself is instant-vs-instant, so the numbers hold whatever
 * timezone the server or the kiosk tablet happens to be on.
 */

const at = (hhmm: string) => new Date(`2026-08-09T${hhmm}:00Z`);

describe('the three reported cases', () => {
  it('3:50 now, 4:00 appointment → about 10 minutes (it said ~5)', () => {
    expect(kioskWait(at('12:50'), at('13:00'))).toEqual({ kind: 'WAIT', minutes: 10 });
  });

  it('3:53 now, 4:30 appointment → about 35 minutes (it said 5)', () => {
    // 37 minutes, rounded to the nearest 5 for a readable sign.
    expect(kioskWait(at('12:53'), at('13:30'))).toEqual({ kind: 'WAIT', minutes: 35 });
  });

  it('5:00 now, 1:00 appointment → overdue, never a future countdown (it said 45)', () => {
    const wait = kioskWait(at('14:00'), at('10:00'), 'Asia/Amman');
    expect(wait.kind).toBe('OVERDUE');
    // The message names the slot in CLINIC time: 10:00Z is 13:00 in Amman.
    if (wait.kind === 'OVERDUE') expect(wait.scheduledHm).toBe('13:00');
  });
});

describe('kioskWait boundaries', () => {
  it('counts down when the appointment is well ahead', () => {
    expect(kioskWait(at('09:00'), at('11:00'))).toEqual({ kind: 'WAIT', minutes: 120 });
  });

  it('says it is your turn at the appointment time', () => {
    expect(kioskWait(at('10:00'), at('10:00'))).toEqual({ kind: 'NOW' });
  });

  it('says it is your turn within a couple of minutes either side', () => {
    expect(kioskWait(at('09:58'), at('10:00'))).toEqual({ kind: 'NOW' });
    expect(kioskWait(at('10:02'), at('10:00'))).toEqual({ kind: 'NOW' });
  });

  it('stays "your turn" for a normal late arrival, inside the grace', () => {
    expect(kioskWait(at('10:14'), at('10:00'))).toEqual({ kind: 'NOW' });
    expect(kioskWait(at('10:15'), at('10:00'))).toEqual({ kind: 'NOW' });
  });

  it('flips to overdue once past the grace', () => {
    expect(kioskWait(at('10:16'), at('10:00')).kind).toBe('OVERDUE');
  });

  it('never counts down to zero — a short wait rounds up, not away', () => {
    // 3 minutes is past the "it's your turn" window but rounds to 5, not 0.
    expect(kioskWait(at('09:57'), at('10:00'))).toEqual({ kind: 'WAIT', minutes: 5 });
  });

  it('is unaffected by the machine timezone — the same instants either way', () => {
    // 13:00 Amman is 10:00Z; an hour before it is 09:00Z whatever the host.
    expect(kioskWait(at('09:00'), at('10:00'))).toEqual({ kind: 'WAIT', minutes: 60 });
  });
});

describe('minutesUntil', () => {
  it('is positive before the slot and negative after it', () => {
    expect(minutesUntil(at('09:30'), at('10:00'))).toBe(30);
    expect(minutesUntil(at('10:30'), at('10:00'))).toBe(-30);
  });
});
