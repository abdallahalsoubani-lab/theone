import { describe, expect, it } from 'vitest';

import type { CalendarAppointment } from '@/lib/appointments/queries';

import { eventsForView } from '../eventsForView';

const base: Omit<CalendarAppointment, 'therapists'> = {
  id: 'appt-1',
  patientId: 'p1',
  patientFullNameEn: 'John Doe',
  patientFullNameAr: 'جون دو',
  roomId: null,
  roomName: null,
  startsAt: new Date('2026-06-01T09:00:00Z'),
  durationMinutes: 30,
  status: 'SCHEDULED',
  notes: null,
  seriesId: null,
};

const multiTherapist: CalendarAppointment = {
  ...base,
  therapists: [
    { id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' },
    { id: 't2', fullNameEn: 'Layan', fullNameAr: 'ليان' },
  ],
};

describe('eventsForView', () => {
  it('day view → one event per therapist (resource columns)', () => {
    const events = eventsForView([multiTherapist], 'day', 'en');
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.id)).toEqual(['appt-1::t1', 'appt-1::t2']);
    expect(events.map((e) => e.resourceId)).toEqual(['t1', 't2']);
    // Both reference the same underlying appointment.
    expect(events.every((e) => e.appointment?.id === 'appt-1')).toBe(true);
  });

  it('week view → ONE event for a multi-therapist appointment (no duplicates)', () => {
    const events = eventsForView([multiTherapist], 'week', 'en');
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe('appt-1');
    expect(events[0]!.resourceId).toBe('t1'); // first therapist → tint + "+N" hint
  });

  it('month and agenda also collapse to one event per appointment', () => {
    expect(eventsForView([multiTherapist], 'month', 'en')).toHaveLength(1);
    expect(eventsForView([multiTherapist], 'agenda', 'en')).toHaveLength(1);
  });

  it('computes end from duration and titles by locale', () => {
    const [en] = eventsForView([multiTherapist], 'week', 'en');
    const [ar] = eventsForView([multiTherapist], 'week', 'ar');
    expect(en!.title).toBe('John Doe');
    expect(ar!.title).toBe('جون دو');
    expect(en!.end.getTime() - en!.start.getTime()).toBe(30 * 60_000);
  });

  it('single-therapist appointment is one event in every view', () => {
    const single: CalendarAppointment = {
      ...base,
      therapists: [{ id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' }],
    };
    expect(eventsForView([single], 'day', 'en')).toHaveLength(1);
    expect(eventsForView([single], 'week', 'en')).toHaveLength(1);
    expect(eventsForView([single], 'day', 'en')[0]!.id).toBe('appt-1::t1');
    expect(eventsForView([single], 'week', 'en')[0]!.id).toBe('appt-1');
  });
});
