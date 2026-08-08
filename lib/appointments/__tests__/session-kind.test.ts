import { describe, expect, it } from 'vitest';

import { cliniciansForKind, kindOfSelection } from '../session-kind';

/**
 * PT-B4 item 1 — the clinic's rule is that a new patient is assessed by the
 * doctor before therapy is scheduled, so a doctor session has to be bookable
 * from the same form as a therapist session. Same AppointmentType (SESSION);
 * only the offered clinicians differ, and the assignee's role stays the truth
 * about what the visit was (lib/patients/first-visit.ts derives it that way).
 */

const staff = [
  { id: 'th-1', role: 'THERAPIST' },
  { id: 'dr-1', role: 'DOCTOR' },
  { id: 'th-2', role: 'THERAPIST' },
  { id: 'dr-2', role: 'DOCTOR' },
];

describe('cliniciansForKind', () => {
  it('offers only doctors for a doctor session', () => {
    expect(cliniciansForKind(staff, 'DOCTOR').map((c) => c.id)).toEqual(['dr-1', 'dr-2']);
  });

  it('offers only therapists for a therapist session', () => {
    expect(cliniciansForKind(staff, 'THERAPIST').map((c) => c.id)).toEqual(['th-1', 'th-2']);
  });

  it('treats a clinician with no role as a therapist — every older caller means that', () => {
    const legacy = [{ id: 'x' }, { id: 'dr-1', role: 'DOCTOR' }];
    expect(cliniciansForKind(legacy, 'THERAPIST').map((c) => c.id)).toEqual(['x']);
    expect(cliniciansForKind(legacy, 'DOCTOR').map((c) => c.id)).toEqual(['dr-1']);
  });

  it('never drops a clinician — the two kinds partition the staff list', () => {
    const doctors = cliniciansForKind(staff, 'DOCTOR');
    const therapists = cliniciansForKind(staff, 'THERAPIST');
    expect(doctors.length + therapists.length).toBe(staff.length);
    expect(new Set([...doctors, ...therapists].map((c) => c.id)).size).toBe(staff.length);
  });

  it('returns an empty list when the clinic has nobody of that kind', () => {
    expect(cliniciansForKind([{ id: 'th-1', role: 'THERAPIST' }], 'DOCTOR')).toEqual([]);
  });
});

describe('kindOfSelection', () => {
  it('reads a prefilled doctor as a doctor session — dragging into a doctor lane', () => {
    expect(kindOfSelection(staff, ['dr-1'])).toBe('DOCTOR');
  });

  it('reads a prefilled therapist as a therapist session', () => {
    expect(kindOfSelection(staff, ['th-1'])).toBe('THERAPIST');
  });

  it('a mixed selection counts as a doctor session — the doctor is the reason for the visit', () => {
    expect(kindOfSelection(staff, ['th-1', 'dr-1'])).toBe('DOCTOR');
  });

  it('defaults to a therapist session with nothing selected', () => {
    expect(kindOfSelection(staff, [])).toBe('THERAPIST');
  });
});
