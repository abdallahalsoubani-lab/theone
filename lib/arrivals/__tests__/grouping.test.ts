import { describe, expect, it } from 'vitest';

import { groupAdjacentAppointments } from '../grouping';

/** Helper: an appointment starting at HH:MM today for `dur` minutes. */
function appt(id: string, hhmm: string, dur: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2026, 6, 21, h, m, 0, 0);
  return { id, startsAt: d, durationMinutes: dur };
}
const ids = (runs: { id: string }[][]) => runs.map((r) => r.map((a) => a.id));

describe('groupAdjacentAppointments (July #3)', () => {
  it('single appointment → one run of one', () => {
    expect(ids(groupAdjacentAppointments([appt('a', '10:00', 30)]))).toEqual([['a']]);
  });

  it('empty input → no runs', () => {
    expect(groupAdjacentAppointments([])).toEqual([]);
  });

  it('three exactly-adjacent appointments → one run', () => {
    const r = groupAdjacentAppointments([
      appt('a', '10:00', 30),
      appt('b', '10:30', 30),
      appt('c', '11:00', 45),
    ]);
    expect(ids(r)).toEqual([['a', 'b', 'c']]);
  });

  it('A–B adjacent, then a gap, then C → two runs {A,B} and {C}', () => {
    const r = groupAdjacentAppointments([
      appt('a', '10:00', 30),
      appt('b', '10:30', 30),
      appt('c', '13:00', 30), // gap after 11:00
    ]);
    expect(ids(r)).toEqual([['a', 'b'], ['c']]);
  });

  it('a positive gap (even 5 min) breaks the run', () => {
    const r = groupAdjacentAppointments([appt('a', '10:00', 30), appt('b', '10:35', 30)]);
    expect(ids(r)).toEqual([['a'], ['b']]);
  });

  it('overlap is NOT adjacency → separate runs', () => {
    const r = groupAdjacentAppointments([appt('a', '10:00', 30), appt('b', '10:15', 30)]);
    expect(ids(r)).toEqual([['a'], ['b']]);
  });

  it('duplicate start times → separate runs', () => {
    const r = groupAdjacentAppointments([appt('a', '10:00', 30), appt('b', '10:00', 30)]);
    expect(ids(r)).toEqual([['a'], ['b']]);
  });

  it('accepts unsorted input (sorts by start first)', () => {
    const r = groupAdjacentAppointments([
      appt('c', '11:00', 30),
      appt('a', '10:00', 30),
      appt('b', '10:30', 30),
    ]);
    expect(ids(r)).toEqual([['a', 'b', 'c']]);
  });
});
