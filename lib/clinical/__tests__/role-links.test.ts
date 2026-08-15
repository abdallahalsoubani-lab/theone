import { describe, expect, it } from 'vitest';

import {
  planEditHref,
  planHref,
  roleCalendarHref,
  sessionNoteAddendumHref,
  sessionNoteCreateHref,
  sessionNoteEditHref,
  weeklyReviewHref,
} from '../role-links';

/**
 * Prompt 37 item 3 — timeline/plan links are built for the VIEWER's role;
 * roles that lack a surface get null (rendered unlinked), never another
 * role's segment. Companion: link-targets.test.ts asserts these segments
 * exist in the app tree.
 */

describe('roleCalendarHref', () => {
  it('every staff role gets ITS OWN calendar; patients get none', () => {
    expect(roleCalendarHref('ADMIN')).toBe('/admin/calendar');
    expect(roleCalendarHref('SECRETARY')).toBe('/secretary/calendar');
    expect(roleCalendarHref('DOCTOR')).toBe('/doctor/calendar');
    expect(roleCalendarHref('THERAPIST')).toBe('/therapist/calendar');
    expect(roleCalendarHref('PATIENT')).toBeNull();
  });
});

describe('planHref / planEditHref', () => {
  it('doctor and therapist link into their own plan routes', () => {
    expect(planHref('DOCTOR', 'p1')).toBe('/doctor/plans/p1');
    expect(planHref('THERAPIST', 'p1')).toBe('/therapist/plans/p1');
    expect(planEditHref('DOCTOR', 'p1')).toBe('/doctor/plans/p1/edit');
    expect(planEditHref('THERAPIST', 'p1')).toBe('/therapist/plans/p1/edit');
  });

  it('ADMIN and SECRETARY get null — no /doctor teleport (the A-19 disease)', () => {
    for (const role of ['ADMIN', 'SECRETARY', 'PATIENT'] as const) {
      expect(planHref(role, 'p1')).toBeNull();
      expect(planEditHref(role, 'p1')).toBeNull();
    }
  });
});

describe('session-report hrefs (Prompt 46 row 5 — doctor mirror routes)', () => {
  it('therapist + admin use the /therapist routes; doctor gets its mirror; others none', () => {
    expect(sessionNoteEditHref('THERAPIST', 'n1')).toBe('/therapist/sessions/notes/n1/edit');
    expect(sessionNoteEditHref('ADMIN', 'n1')).toBe('/therapist/sessions/notes/n1/edit');
    expect(sessionNoteEditHref('DOCTOR', 'n1')).toBe('/doctor/sessions/notes/n1/edit');
    expect(sessionNoteEditHref('SECRETARY', 'n1')).toBeNull();
    expect(sessionNoteEditHref('PATIENT', 'n1')).toBeNull();

    expect(sessionNoteCreateHref('THERAPIST', 'a1')).toBe('/therapist/sessions/a1/note/new');
    expect(sessionNoteCreateHref('DOCTOR', 'a1')).toBe('/doctor/sessions/a1/note/new');
    expect(sessionNoteCreateHref('SECRETARY', 'a1')).toBeNull();

    expect(sessionNoteAddendumHref('DOCTOR', 'n1')).toBe('/doctor/sessions/notes/n1/addendum');
    expect(sessionNoteAddendumHref('THERAPIST', 'n1')).toBe(
      '/therapist/sessions/notes/n1/addendum',
    );
  });

  it('weekly review is doctor-only (unchanged)', () => {
    expect(weeklyReviewHref('DOCTOR')).toBe('/doctor/reports/weekly');
    expect(weeklyReviewHref('ADMIN')).toBeNull();
    expect(weeklyReviewHref('SECRETARY')).toBeNull();
  });
});
