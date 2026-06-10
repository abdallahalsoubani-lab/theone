import { describe, expect, it } from 'vitest';

import { getAllowedRolesForPath, isPathAllowedForRole } from '../routes';

describe('getAllowedRolesForPath', () => {
  it('maps each role prefix to its own role plus Admin', () => {
    expect(Array.from(getAllowedRolesForPath('/admin/users') ?? [])).toEqual(['ADMIN']);
    expect(Array.from(getAllowedRolesForPath('/secretary/calendar') ?? [])).toEqual([
      'SECRETARY',
      'ADMIN',
    ]);
    expect(Array.from(getAllowedRolesForPath('/doctor/dashboard') ?? [])).toEqual([
      'DOCTOR',
      'ADMIN',
    ]);
    expect(Array.from(getAllowedRolesForPath('/therapist/patients') ?? [])).toEqual([
      'THERAPIST',
      'ADMIN',
    ]);
    expect(Array.from(getAllowedRolesForPath('/patient/home-program') ?? [])).toEqual([
      'PATIENT',
      'ADMIN',
    ]);
  });

  it('/staff is shared across all three clinical roles + Admin', () => {
    const allowed = getAllowedRolesForPath('/staff/leave');
    expect(allowed).not.toBeNull();
    expect(new Set(allowed!)).toEqual(new Set(['SECRETARY', 'DOCTOR', 'THERAPIST', 'ADMIN']));
  });

  it('returns null for paths without a role prefix (no gate)', () => {
    expect(getAllowedRolesForPath('/')).toBeNull();
    expect(getAllowedRolesForPath('/notifications')).toBeNull();
    expect(getAllowedRolesForPath('/style-guide')).toBeNull();
  });

  it('exact prefix match wins — /administer is NOT under /admin', () => {
    // Sanity: substring guards. The matcher checks `=== prefix` OR
    // `startsWith(prefix + '/')` — so look-alike paths slip past correctly.
    expect(getAllowedRolesForPath('/administer/foo')).toBeNull();
    expect(getAllowedRolesForPath('/patients-list')).toBeNull();
  });
});

describe('isPathAllowedForRole', () => {
  it('Admin can navigate any role-prefixed path', () => {
    for (const path of [
      '/admin/users',
      '/secretary/calendar',
      '/doctor/dashboard',
      '/therapist/patients',
      '/patient/home-program',
      '/staff/leave',
    ]) {
      expect(isPathAllowedForRole(path, 'ADMIN')).toBe(true);
    }
  });

  it('clinicians are pinned to their own prefix + shared /staff', () => {
    expect(isPathAllowedForRole('/therapist/patients', 'THERAPIST')).toBe(true);
    expect(isPathAllowedForRole('/staff/leave', 'THERAPIST')).toBe(true);
    expect(isPathAllowedForRole('/doctor/dashboard', 'THERAPIST')).toBe(false);
    expect(isPathAllowedForRole('/admin/users', 'THERAPIST')).toBe(false);
    expect(isPathAllowedForRole('/patient/home-program', 'THERAPIST')).toBe(false);
  });

  it('Patient is locked out of every clinician + admin path', () => {
    expect(isPathAllowedForRole('/patient/home-program', 'PATIENT')).toBe(true);
    expect(isPathAllowedForRole('/admin/users', 'PATIENT')).toBe(false);
    expect(isPathAllowedForRole('/secretary/calendar', 'PATIENT')).toBe(false);
    expect(isPathAllowedForRole('/doctor/dashboard', 'PATIENT')).toBe(false);
    expect(isPathAllowedForRole('/therapist/patients', 'PATIENT')).toBe(false);
    expect(isPathAllowedForRole('/staff/leave', 'PATIENT')).toBe(false);
  });

  it('paths with no role prefix are always allowed', () => {
    for (const role of ['ADMIN', 'SECRETARY', 'DOCTOR', 'THERAPIST', 'PATIENT'] as const) {
      expect(isPathAllowedForRole('/notifications', role)).toBe(true);
      expect(isPathAllowedForRole('/', role)).toBe(true);
    }
  });
});
