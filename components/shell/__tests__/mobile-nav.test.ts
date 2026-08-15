import { describe, expect, it } from 'vitest';

import { adminNavEntries } from '../admin-nav';
import { pickMobileLinks } from '../mobile-nav-links';
import { staffNavEntries } from '../staff-nav';

/**
 * Prompt 46 item C — the mobile drawer had shipped with a hard-coded empty
 * links array, so every role saw an empty drawer below the md breakpoint.
 * These tests pin the two pieces of the fix: the drawer's link-set selection
 * and the admin nav config the Header now shares with the admin layout.
 */

type Link = { label: string; href: string };
const l = (href: string): Link => ({ label: href, href });

describe('pickMobileLinks', () => {
  const staff = [l('/secretary/calendar'), l('/secretary/patients')];
  const admin = [l('/admin/users'), l('/admin/settings')];

  it('admin pages show the admin set', () => {
    expect(pickMobileLinks('/admin', staff, admin)).toBe(admin);
    expect(pickMobileLinks('/admin/users', staff, admin)).toBe(admin);
  });

  it('staff pages show the staff set — even for an Admin who also has admin links', () => {
    expect(pickMobileLinks('/secretary/calendar', staff, admin)).toBe(staff);
    expect(pickMobileLinks('/therapist/dashboard', staff, admin)).toBe(staff);
  });

  it('does not treat /administration-lookalike prefixes as the admin area', () => {
    expect(pickMobileLinks('/administrivia', staff, admin)).toBe(staff);
  });

  it('falls back to the admin set when the staff set is empty', () => {
    expect(pickMobileLinks('/notifications', [], admin)).toBe(admin);
  });

  it('returns an empty set only when both sets are empty (drawer hidden by the Header)', () => {
    expect(pickMobileLinks('/secretary/calendar', [], [])).toEqual([]);
  });
});

describe('adminNavEntries (shared by admin layout + Header drawer)', () => {
  it('every entry targets the /admin area with a label key and icon token', () => {
    const entries = adminNavEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.href.startsWith('/admin/')).toBe(true);
      expect(e.labelKey.length).toBeGreaterThan(0);
      expect(e.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('every role that has a desktop sidebar gets drawer links', () => {
  it('SECRETARY / ADMIN / DOCTOR / THERAPIST are non-empty; PATIENT stays empty (no desktop sidebar either)', () => {
    expect(staffNavEntries('SECRETARY').length).toBeGreaterThan(0);
    expect(staffNavEntries('ADMIN').length).toBeGreaterThan(0);
    expect(staffNavEntries('DOCTOR').length).toBeGreaterThan(0);
    expect(staffNavEntries('THERAPIST').length).toBeGreaterThan(0);
    expect(staffNavEntries('PATIENT').length).toBe(0);
  });
});
