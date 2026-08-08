import { describe, expect, it } from 'vitest';

import { eventsForView } from '@/components/calendar/eventsForView';
import type { CalendarAppointment } from '@/lib/appointments/queries';
import { formatTime } from '@/lib/format/date';

import { clinicDaySpan, clinicHm, parseClinicDateTimeLocal } from '../clinic';

/**
 * PT-B1 item 1 — "the therapist's board showed the booking 3 hours early".
 *
 * The suite runs under TZ=UTC (vitest.config.ts), matching the container, so a
 * regression that leaks the process clock into any of these paths shows up as
 * exactly the reported −3h. Each case walks the FULL round trip a booking
 * makes: what the secretary types → the stored instant → what the therapist's
 * grid positions → what every read-only list prints. All four must agree.
 */

const TZ = 'Asia/Amman'; // fixed UTC+3 — Jordan abolished DST in 2022

/** What the secretary types in the booking modal → the persisted instant. */
function book(wallInput: string): Date {
  const instant = parseClinicDateTimeLocal(wallInput, TZ);
  if (!instant) throw new Error(`unparseable wall time in fixture: ${wallInput}`);
  return instant;
}

/** Where the therapist's react-big-calendar grid puts it, as "HH:MM". */
function gridClock(startsAt: Date, durationMinutes = 30): string {
  const appointment = {
    id: 'a1',
    patientId: 'p1',
    patientFullNameEn: 'Sara',
    patientFullNameAr: 'سارة',
    appointmentType: 'SESSION',
    title: null,
    groupPatients: [],
    therapists: [{ id: 't1', fullNameEn: 'Rawan', fullNameAr: 'روان' }],
    startsAt,
    durationMinutes,
    status: 'SCHEDULED',
  } as unknown as CalendarAppointment;

  const [event] = eventsForView([appointment], 'day', 'en');
  // rbc positions events by the LOCAL fields of these Dates — that is the whole
  // point of the clinic-wall pre-shift, so read them the same way rbc does.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(event!.start.getHours())}:${pad(event!.start.getMinutes())}`;
}

describe('one clock across roles — a booking reads the same everywhere', () => {
  it.each([
    ['morning', '2026-08-10T10:00', '10:00', '10:00 AM', '2026-08-10T07:00:00.000Z'],
    [
      'afternoon (the reported case)',
      '2026-08-10T15:30',
      '15:30',
      '3:30 PM',
      '2026-08-10T12:30:00.000Z',
    ],
    ['evening', '2026-08-10T20:45', '20:45', '8:45 PM', '2026-08-10T17:45:00.000Z'],
    [
      'just after clinic midnight',
      '2026-08-10T00:15',
      '00:15',
      '12:15 AM',
      '2026-08-09T21:15:00.000Z',
    ],
    [
      'just before clinic midnight',
      '2026-08-10T23:45',
      '23:45',
      '11:45 PM',
      '2026-08-10T20:45:00.000Z',
    ],
  ])('%s', (_label, typed, expectedClock, expectedDisplay, expectedInstant) => {
    const startsAt = book(typed);

    // Stored as a real UTC instant, three hours behind the Amman wall clock.
    expect(startsAt.toISOString()).toBe(expectedInstant);

    // Therapist grid, read-only lists, and template/report text all agree.
    expect(gridClock(startsAt)).toBe(expectedClock);
    expect(clinicHm(startsAt, TZ)).toBe(expectedClock);
    expect(formatTime(startsAt, 'en')).toBe(expectedDisplay);
  });

  it('spans midnight without drifting: a 23:45 booking still ends on the next day', () => {
    const startsAt = book('2026-08-10T23:45');
    const [event] = eventsForView(
      [
        {
          id: 'a1',
          patientId: 'p1',
          patientFullNameEn: 'Sara',
          patientFullNameAr: 'سارة',
          appointmentType: 'SESSION',
          title: null,
          groupPatients: [],
          therapists: [{ id: 't1', fullNameEn: 'Rawan', fullNameAr: 'روان' }],
          startsAt,
          durationMinutes: 30,
          status: 'SCHEDULED',
        } as unknown as CalendarAppointment,
      ],
      'day',
      'en',
    );
    expect(event!.end.getDate()).toBe(11);
    expect(event!.end.getHours()).toBe(0);
    expect(event!.end.getMinutes()).toBe(15);
  });
});

describe('clinicDaySpan — calendar fetch windows cover whole clinic days', () => {
  it('starts at Amman midnight, not the process (UTC) midnight', () => {
    // 03:00Z on the 10th is already 06:00 Amman, so "7 days back" must reach
    // the Amman midnight opening 2026-08-03 — i.e. 21:00Z on the 2nd.
    const span = clinicDaySpan(new Date('2026-08-10T03:00:00Z'), 7, 21, TZ);
    expect(span.start.toISOString()).toBe('2026-08-02T21:00:00.000Z');
    expect(span.end.toISOString()).toBe('2026-08-31T21:00:00.000Z');
  });

  it('keeps a booking made in the first clinic hours of the earliest day', () => {
    const span = clinicDaySpan(new Date('2026-08-10T03:00:00Z'), 7, 21, TZ);
    const earlyOnTheFirstDay = book('2026-08-03T00:30'); // 21:30Z on the 2nd
    expect(earlyOnTheFirstDay.getTime()).toBeGreaterThanOrEqual(span.start.getTime());
  });

  it('is a whole number of clinic days regardless of the instant inside them', () => {
    const morning = clinicDaySpan(new Date('2026-08-10T06:00:00Z'), 1, 1, TZ);
    const evening = clinicDaySpan(new Date('2026-08-10T18:00:00Z'), 1, 1, TZ);
    expect(morning).toEqual(evening);
    expect(evening.end.getTime() - evening.start.getTime()).toBe(3 * 86_400_000);
  });
});
