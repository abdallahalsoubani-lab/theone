import { describe, expect, it } from 'vitest';

import type { CalendarAppointment } from '@/lib/appointments/queries';

import { OTHER_LANE_ID, eventsForView } from '../eventsForView';

const base: Omit<CalendarAppointment, 'therapists'> = {
  id: 'appt-1',
  patientId: 'p1',
  patientFullNameEn: 'John Doe',
  patientFullNameAr: 'جون دو',
  groupPatients: [],
  roomId: null,
  roomName: null,
  startsAt: new Date('2026-06-01T09:00:00Z'),
  durationMinutes: 30,
  status: 'SCHEDULED',
  appointmentType: 'SESSION',
  title: null,
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

  it('therapist-less STRETCHING renders once in the synthetic Other lane (July #8)', () => {
    const stretch: CalendarAppointment = {
      ...base,
      appointmentType: 'STRETCHING',
      roomId: 'r1',
      roomName: 'Room A',
      therapists: [], // no therapist column
    };
    const day = eventsForView([stretch], 'day', 'en');
    expect(day).toHaveLength(1); // does NOT vanish
    expect(day[0]!.resourceId).toBe(OTHER_LANE_ID);
    expect(day[0]!.id).toBe('appt-1');
    // Non-day views: one chip, falls back to the Other lane id.
    const week = eventsForView([stretch], 'week', 'en');
    expect(week).toHaveLength(1);
    expect(week[0]!.resourceId).toBe(OTHER_LANE_ID);
  });

  it('GROUP chip titles by workshop label + member count, renders per therapist (July #8 pt3)', () => {
    const group: CalendarAppointment = {
      ...base,
      id: 'grp-1',
      patientId: null,
      patientFullNameEn: '',
      patientFullNameAr: '',
      appointmentType: 'GROUP',
      title: 'Back-care workshop',
      groupPatients: [
        { id: 'p1', fullNameEn: 'John', fullNameAr: 'جون' },
        { id: 'p2', fullNameEn: 'Mona', fullNameAr: 'منى' },
      ],
      therapists: [
        { id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' },
        { id: 't2', fullNameEn: 'Layan', fullNameAr: 'ليان' },
      ],
    };
    // Day view: one chip per therapist column, both carrying the group label.
    const day = eventsForView([group], 'day', 'en');
    expect(day).toHaveLength(2);
    expect(day.map((e) => e.id)).toEqual(['grp-1::t1', 'grp-1::t2']);
    expect(day.every((e) => e.title === 'Back-care workshop (2)')).toBe(true);
  });

  it('GROUP without a label falls back to the first member name + count', () => {
    const group: CalendarAppointment = {
      ...base,
      id: 'grp-2',
      patientId: null,
      patientFullNameEn: '',
      patientFullNameAr: '',
      appointmentType: 'GROUP',
      title: null,
      groupPatients: [
        { id: 'p1', fullNameEn: 'John', fullNameAr: 'جون' },
        { id: 'p2', fullNameEn: 'Mona', fullNameAr: 'منى' },
      ],
      therapists: [{ id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' }],
    };
    expect(eventsForView([group], 'week', 'en')[0]!.title).toBe('John (2)');
    expect(eventsForView([group], 'week', 'ar')[0]!.title).toBe('جون (2)');
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
