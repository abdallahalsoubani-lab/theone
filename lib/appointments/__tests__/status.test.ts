import { AppointmentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { canTransition, permissionForTransition, STATUS_TRANSITIONS } from '../status';

const ALL = Object.values(AppointmentStatus);

describe('canTransition', () => {
  it('mirrors the STATUS_TRANSITIONS map exactly', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const expected = STATUS_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(expected);
      }
    }
  });

  it('treats COMPLETED / CANCELLED / NO_SHOW as terminal', () => {
    for (const from of [
      AppointmentStatus.COMPLETED,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.NO_SHOW,
    ]) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('SCHEDULED can reach CONFIRMED / IN_PROGRESS / CANCELLED / NO_SHOW', () => {
    expect(canTransition('SCHEDULED', 'CONFIRMED')).toBe(true);
    expect(canTransition('SCHEDULED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('SCHEDULED', 'CANCELLED')).toBe(true);
    expect(canTransition('SCHEDULED', 'NO_SHOW')).toBe(true);
    expect(canTransition('SCHEDULED', 'COMPLETED')).toBe(false);
  });

  it('IN_PROGRESS may only reach COMPLETED', () => {
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    for (const to of ALL.filter((s) => s !== 'COMPLETED')) {
      expect(canTransition('IN_PROGRESS', to)).toBe(false);
    }
  });
});

describe('permissionForTransition', () => {
  it('returns null for illegal transitions', () => {
    expect(permissionForTransition('COMPLETED', 'SCHEDULED')).toBeNull();
    expect(permissionForTransition('SCHEDULED', 'COMPLETED')).toBeNull();
  });

  it('maps legal transitions to their permission codes', () => {
    expect(permissionForTransition('SCHEDULED', 'CONFIRMED')).toBe('appointments.update');
    expect(permissionForTransition('SCHEDULED', 'IN_PROGRESS')).toBe('appointments.checkin');
    expect(permissionForTransition('SCHEDULED', 'CANCELLED')).toBe('appointments.cancel');
    expect(permissionForTransition('SCHEDULED', 'NO_SHOW')).toBe('appointments.noshow');
    expect(permissionForTransition('IN_PROGRESS', 'COMPLETED')).toBe('appointments.complete');
  });
});
