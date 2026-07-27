import { describe, expect, it } from 'vitest';

import type { CalendarAppointment } from '@/lib/appointments/queries';

import { appointmentTooltipModel, hoverCapable } from '../appointmentTooltipModel';

/**
 * Prompt 56 — the hover-tooltip content contract. Built ONLY from the event
 * payload: the phone row mirrors the P15 boundary (present in a
 * secretary-shaped payload, null in a therapist-shaped one), EVENT shows its
 * title with no patient, every therapist is listed, and the note passes
 * through untruncated.
 */

const base: CalendarAppointment = {
  id: 'a1',
  patientId: 'p1',
  patientFullNameEn: 'John Doe',
  patientFullNameAr: 'جون دو',
  title: null,
  groupPatients: [],
  therapists: [
    { id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' },
    { id: 't2', fullNameEn: 'Layan', fullNameAr: 'ليان' },
  ],
  roomId: 'r1',
  roomName: 'Room A',
  patientPhone: '+962790000001',
  startsAt: new Date('2026-06-01T09:00:00Z'), // 12:00 Amman
  durationMinutes: 45,
  status: 'CONFIRMED',
  appointmentType: 'SESSION',
  notes: 'Re-assessment before plan renewal',
  seriesId: null,
};

describe('appointmentTooltipModel', () => {
  it('secretary payload → full field set including the phone', () => {
    const m = appointmentTooltipModel(base, 'ar');
    expect(m.primary).toBe('جون دو');
    expect(m.secondary).toBe('John Doe'); // both scripts when both exist
    expect(m.timeRange).toBe('12:00–12:45'); // clinic-wall, machine-TZ-proof
    expect(m.durationMinutes).toBe(45);
    expect(m.therapists).toEqual(['أحمد', 'ليان']); // ALL therapists
    expect(m.room).toBe('Room A');
    expect(m.typeKey).toBe('typeSession');
    expect(m.statusKey).toBe('confirmed');
    expect(m.note).toBe('Re-assessment before plan renewal');
    expect(m.phone).toBe('+962790000001');
  });

  it('therapist-shaped payload (feed stripped the phone) → NO phone (P15 regression)', () => {
    const m = appointmentTooltipModel({ ...base, patientPhone: null }, 'en');
    expect(m.phone).toBeNull();
    // Everything else stays intact.
    expect(m.primary).toBe('John Doe');
    expect(m.therapists).toEqual(['Ahmad', 'Layan']);
  });

  it('EVENT → its title, no patient names, no phone even if a value leaked in', () => {
    const m = appointmentTooltipModel(
      {
        ...base,
        appointmentType: 'EVENT',
        patientId: null,
        patientFullNameEn: '',
        patientFullNameAr: '',
        title: 'Maintenance',
        patientPhone: '+962790000001',
      },
      'en',
    );
    expect(m.primary).toBe('Maintenance');
    expect(m.secondary).toBeNull();
    expect(m.phone).toBeNull();
  });

  it('GROUP and WORKSHOP → label + member names, typeKey shared', () => {
    const group: CalendarAppointment = {
      ...base,
      appointmentType: 'GROUP',
      patientId: null,
      patientFullNameEn: '',
      patientFullNameAr: '',
      title: 'Back-care workshop',
      groupPatients: [
        { id: 'p1', fullNameEn: 'John', fullNameAr: 'جون' },
        { id: 'p2', fullNameEn: 'Mona', fullNameAr: 'منى' },
      ],
    };
    const m = appointmentTooltipModel(group, 'ar');
    expect(m.primary).toBe('Back-care workshop');
    expect(m.groupMembers).toEqual(['جون', 'منى']);
    expect(m.typeKey).toBe('typeGroup');
    expect(appointmentTooltipModel({ ...group, appointmentType: 'WORKSHOP' }, 'ar').typeKey).toBe(
      'typeGroup',
    );
  });

  it('empty / whitespace note → no note row; long note passes through untruncated', () => {
    expect(appointmentTooltipModel({ ...base, notes: null }, 'en').note).toBeNull();
    expect(appointmentTooltipModel({ ...base, notes: '   ' }, 'en').note).toBeNull();
    const long = 'ملاحظة طويلة جداً '.repeat(40).trim();
    expect(appointmentTooltipModel({ ...base, notes: long }, 'ar').note).toBe(long);
  });

  it('same-script-only names → no duplicate secondary line', () => {
    const m = appointmentTooltipModel(
      { ...base, patientFullNameEn: '', patientFullNameAr: 'هالة سمّور' },
      'ar',
    );
    expect(m.primary).toBe('هالة سمّور');
    expect(m.secondary).toBeNull();
  });

  it('status enum → localized status keys (incl. the underscored ones)', () => {
    expect(appointmentTooltipModel({ ...base, status: 'IN_PROGRESS' }, 'en').statusKey).toBe(
      'inProgress',
    );
    expect(appointmentTooltipModel({ ...base, status: 'NO_SHOW' }, 'en').statusKey).toBe('noShow');
  });
});

describe('hoverCapable (decision أ — capability gate, not screen width)', () => {
  it('no matchMedia (SSR / old jsdom) → false', () => {
    expect(hoverCapable(undefined)).toBe(false);
  });

  it('reflects the media query result', () => {
    expect(hoverCapable(() => ({ matches: true }))).toBe(true);
    expect(hoverCapable(() => ({ matches: false }))).toBe(false);
  });

  it('queries hover + fine pointer, and a throwing matchMedia fails closed', () => {
    let seen = '';
    hoverCapable((q) => {
      seen = q;
      return { matches: true };
    });
    expect(seen).toBe('(hover: hover) and (pointer: fine)');
    expect(
      hoverCapable(() => {
        throw new Error('boom');
      }),
    ).toBe(false);
  });
});
