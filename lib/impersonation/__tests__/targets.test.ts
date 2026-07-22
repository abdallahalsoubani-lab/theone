import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { canActAsTarget } from '../targets';

describe('canActAsTarget (A-20 owner ruling — Prompt 39)', () => {
  it('allows staff roles only', () => {
    expect(canActAsTarget(UserRole.SECRETARY)).toBe(true);
    expect(canActAsTarget(UserRole.DOCTOR)).toBe(true);
    expect(canActAsTarget(UserRole.THERAPIST)).toBe(true);
  });

  it('never renders/permits Act-As for PATIENT or ADMIN targets', () => {
    expect(canActAsTarget(UserRole.PATIENT)).toBe(false);
    expect(canActAsTarget(UserRole.ADMIN)).toBe(false);
  });
});
