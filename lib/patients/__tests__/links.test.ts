import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { patientProfileHref, patientsBasePath } from '../links';

describe('patientProfileHref (Prompt 33 — A-19)', () => {
  it('keeps every staff role inside its own interface', () => {
    expect(patientProfileHref(UserRole.ADMIN, 'p1')).toBe('/admin/patients/p1');
    expect(patientProfileHref(UserRole.SECRETARY, 'p1')).toBe('/secretary/patients/p1');
    expect(patientProfileHref(UserRole.DOCTOR, 'p1')).toBe('/doctor/patients/p1');
    expect(patientProfileHref(UserRole.THERAPIST, 'p1')).toBe('/therapist/patients/p1');
  });

  it('falls back to the secretary segment for non-staff roles (pre-fix behaviour)', () => {
    expect(patientsBasePath(UserRole.PATIENT)).toBe('/secretary/patients');
  });
});
