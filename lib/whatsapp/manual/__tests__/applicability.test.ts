import { describe, expect, it } from 'vitest';

import { applicableManualTypes, isManualTypeApplicable } from '../applicability';

/**
 * P60 §4.2 — the applicability rules are the SERVER's authority (the panel
 * only mirrors them). Pinned per type + the three explicit rejections the
 * prompt names.
 */
const NOW = new Date('2030-05-10T08:00:00Z');
const base = {
  status: 'SCHEDULED' as const,
  startsAt: new Date('2030-05-11T08:00:00Z'),
  durationMinutes: 60,
  checkedInAt: null,
  hasPatient: true,
  hasPhone: true,
  customApproved: true,
  now: NOW,
};

describe('applicableManualTypes', () => {
  it('future SCHEDULED/CONFIRMED → confirmation, reminder, reschedule (+ custom when approved)', () => {
    expect(applicableManualTypes(base)).toEqual([
      'CONFIRMATION',
      'REMINDER',
      'RESCHEDULE',
      'CUSTOM',
    ]);
    expect(applicableManualTypes({ ...base, status: 'CONFIRMED' })).toEqual([
      'CONFIRMATION',
      'REMINDER',
      'RESCHEDULE',
      'CUSTOM',
    ]);
  });

  it('CANCELLED → cancellation notice (+ custom) only', () => {
    expect(applicableManualTypes({ ...base, status: 'CANCELLED' })).toEqual([
      'CANCELLATION',
      'CUSTOM',
    ]);
  });

  it('checked-in and not ended → arrival appears; after the end it is gone', () => {
    const inProgress = {
      ...base,
      status: 'IN_PROGRESS' as const,
      startsAt: new Date('2030-05-10T07:30:00Z'),
      checkedInAt: new Date('2030-05-10T07:25:00Z'),
    };
    expect(applicableManualTypes(inProgress)).toEqual(['ARRIVAL', 'CUSTOM']);
    // checkedInAt set while still SCHEDULED (arrived early) also counts.
    expect(
      isManualTypeApplicable('ARRIVAL', {
        ...base,
        startsAt: new Date('2030-05-10T08:30:00Z'),
        checkedInAt: new Date('2030-05-10T07:55:00Z'),
      }),
    ).toBe(true);
    // Ended (start + duration in the past) → no arrival message.
    expect(
      isManualTypeApplicable('ARRIVAL', {
        ...inProgress,
        startsAt: new Date('2030-05-10T06:00:00Z'),
        durationMinutes: 60,
      }),
    ).toBe(false);
  });

  it('the three named rejections', () => {
    // cancellation on a SCHEDULED appointment
    expect(isManualTypeApplicable('CANCELLATION', base)).toBe(false);
    // confirmation on a CANCELLED one
    expect(isManualTypeApplicable('CONFIRMATION', { ...base, status: 'CANCELLED' })).toBe(false);
    // arrival on a not-checked-in one
    expect(isManualTypeApplicable('ARRIVAL', base)).toBe(false);
  });

  it('a started appointment offers no confirmation/reminder/reschedule', () => {
    const started = { ...base, startsAt: new Date('2030-05-10T07:00:00Z') };
    expect(applicableManualTypes(started)).toEqual(['CUSTOM']);
  });

  it('custom hidden while the frame is pending approval', () => {
    expect(applicableManualTypes({ ...base, customApproved: false })).toEqual([
      'CONFIRMATION',
      'REMINDER',
      'RESCHEDULE',
    ]);
  });

  it('no patient or no phone → nothing at all', () => {
    expect(applicableManualTypes({ ...base, hasPatient: false })).toEqual([]);
    expect(applicableManualTypes({ ...base, hasPhone: false })).toEqual([]);
  });
});
