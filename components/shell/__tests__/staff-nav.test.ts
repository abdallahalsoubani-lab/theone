import { describe, expect, it } from 'vitest';

import { staffNavEntries } from '../staff-nav';

/**
 * Prompt 22 §3.2 — the sidebar must be built from the EFFECTIVE role so an
 * impersonated user is never handed links whose pages their RBAC grants
 * reject (the ForbiddenError crash class QA hit while acting as a
 * Doctor/Therapist).
 */
describe('staffNavEntries', () => {
  it('DOCTOR never receives secretary-only surfaces', () => {
    const hrefs = staffNavEntries('DOCTOR').map((e) => e.href);
    for (const banned of [
      '/secretary/inbox',
      '/secretary/arrivals',
      '/secretary/intake-submissions',
      '/secretary/patients',
      '/secretary/calendar',
      '/secretary/waitlist',
    ]) {
      expect(hrefs).not.toContain(banned);
    }
    expect(hrefs).toContain('/doctor/dashboard');
    expect(hrefs).toContain('/doctor/plans');
  });

  it('THERAPIST never receives secretary-only surfaces', () => {
    const hrefs = staffNavEntries('THERAPIST').map((e) => e.href);
    expect(hrefs.every((h) => !h.startsWith('/secretary'))).toBe(true);
    expect(hrefs).toContain('/therapist/dashboard');
    expect(hrefs).toContain('/therapist/calendar');
  });

  it('SECRETARY and ADMIN share the secretary operational hub', () => {
    expect(staffNavEntries('SECRETARY')).toEqual(staffNavEntries('ADMIN'));
    const hrefs = staffNavEntries('SECRETARY').map((e) => e.href);
    expect(hrefs).toContain('/secretary/calendar');
    expect(hrefs).toContain('/secretary/inbox');
  });

  it('PATIENT gets no staff links at all', () => {
    expect(staffNavEntries('PATIENT')).toEqual([]);
  });
});
