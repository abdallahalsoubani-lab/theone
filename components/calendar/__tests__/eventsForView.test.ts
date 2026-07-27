import { describe, expect, it } from 'vitest';

import type { CalendarAppointment } from '@/lib/appointments/queries';

import { OTHER_LANE_ID, eventCardContent, eventsForView } from '../eventsForView';

const base: Omit<CalendarAppointment, 'therapists'> = {
  id: 'appt-1',
  patientId: 'p1',
  patientFullNameEn: 'John Doe',
  patientFullNameAr: 'جون دو',
  groupPatients: [],
  roomId: null,
  roomName: null,
  patientPhone: null,
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

describe('clinic-wall grid mapping (Prompt 31 — P-8)', () => {
  // Suite runs TZ=UTC (prod/browser-agnostic parity): local getters read UTC,
  // so the +3h Amman shift is directly observable.
  it('positions events at clinic wall time, not the machine time', () => {
    const single: CalendarAppointment = {
      ...base,
      // 07:00Z = 10:00 Amman — the P-8 case: booked 10:00, therapist saw 07:00.
      startsAt: new Date('2026-06-01T07:00:00Z'),
      therapists: [{ id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' }],
    };
    const [event] = eventsForView([single], 'day', 'en');
    expect(event!.start.getHours()).toBe(10);
    expect(event!.start.getMinutes()).toBe(0);
    expect(event!.end.getHours()).toBe(10);
    expect(event!.end.getMinutes()).toBe(30);
    // The true instant stays untouched on the payload for labels/actions.
    expect(event!.appointment!.startsAt.toISOString()).toBe('2026-06-01T07:00:00.000Z');
  });

  it('an evening appointment stays on its clinic calendar day', () => {
    const single: CalendarAppointment = {
      ...base,
      // 21:30Z on the 1st = 00:30 Amman on the 2nd — must land on day 2.
      startsAt: new Date('2026-06-01T21:30:00Z'),
      therapists: [{ id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' }],
    };
    const [event] = eventsForView([single], 'week', 'en');
    expect(event!.start.getDate()).toBe(2);
    expect(event!.start.getHours()).toBe(0);
    expect(event!.start.getMinutes()).toBe(30);
  });
});

describe('name-first cards (Prompt 55 §2 — clinic request, reverses P38 NI-10)', () => {
  it('no view ever prefixes the start time to the chip title — the grid rows carry the hour', () => {
    const event: CalendarAppointment = {
      ...base,
      appointmentType: 'EVENT',
      patientId: null,
      patientFullNameEn: '',
      patientFullNameAr: '',
      title: 'Maintenance',
      startsAt: new Date('2026-06-01T06:30:00Z'),
      therapists: [{ id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' }],
    };
    // EVENT keeps its label as-is (P29 behavior, minus the time).
    expect(eventsForView([event], 'day', 'en')[0]!.title).toBe('Maintenance');
    const session: CalendarAppointment = {
      ...base,
      startsAt: new Date('2026-06-01T13:15:00Z'),
      therapists: [{ id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' }],
    };
    for (const view of ['day', 'week', 'month', 'agenda'] as const) {
      for (const locale of ['en', 'ar'] as const) {
        expect(eventsForView([session], view, locale)[0]!.title).not.toMatch(/\d{2}:\d{2}/);
      }
    }
    expect(eventsForView([session], 'week', 'ar')[0]!.title).toBe('جون دو');
  });

  it('eventCardContent: patient name + booking note only — no time string, no therapist name', () => {
    const withNote: CalendarAppointment = {
      ...base,
      notes: '  Re-assessment  ',
      therapists: [{ id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' }],
    };
    const [chip] = eventsForView([withNote], 'day', 'en');
    const card = eventCardContent(chip!);
    expect(card.primary).toBe('John Doe');
    expect(card.note).toBe('Re-assessment');
    expect(card.primary).not.toMatch(/\d{2}:\d{2}/);
    expect(JSON.stringify([card.primary, card.note])).not.toContain('Ahmad');
  });

  it('eventCardContent: empty / whitespace / absent note → single line (note null)', () => {
    const noNote: CalendarAppointment = {
      ...base,
      notes: null,
      therapists: [{ id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' }],
    };
    const blankNote: CalendarAppointment = { ...noNote, notes: '   ' };
    expect(eventCardContent(eventsForView([noNote], 'day', 'en')[0]!).note).toBeNull();
    expect(eventCardContent(eventsForView([blankNote], 'day', 'en')[0]!).note).toBeNull();
    // Leave overlays (no appointment payload) stay title-only.
    expect(eventCardContent({ title: 'في إجازة' })).toEqual({ primary: 'في إجازة', note: null });
  });
});
