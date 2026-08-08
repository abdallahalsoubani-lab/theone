import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PT-B4 item 3 — the sidebar counters.
 *
 * These were computed inline in the (staff) layout, which the App Router
 * reuses across sibling navigations without re-running it, so the numbers
 * froze at the first paint: three intake requests could arrive and the badge
 * would still show the count from whenever the secretary last hard-loaded.
 * The computation lives here now so the layout's first paint and the
 * sidebar's poll run the SAME code and cannot disagree.
 */

const counts = vi.hoisted(() => ({
  inbox: 0,
  waitlist: 0,
  submissions: 0,
  approvals: 0,
  unconfirmed: 0,
  waInbox: 0,
  calls: [] as string[],
}));

vi.mock('@/lib/inbox/queries', () => ({
  countUnresolvedInbox: vi.fn(async () => {
    counts.calls.push('inbox');
    return counts.inbox;
  }),
}));
vi.mock('@/lib/waitlist/queries', () => ({
  countActiveWaitlist: vi.fn(async () => {
    counts.calls.push('waitlist');
    return counts.waitlist;
  }),
}));
vi.mock('@/lib/intake-submissions/queries', () => ({
  countPendingSubmissions: vi.fn(async () => {
    counts.calls.push('submissions');
    return counts.submissions;
  }),
}));
vi.mock('@/lib/clinical/home-program/approval', () => ({
  countPendingApprovals: vi.fn(async (id: string | null) => {
    counts.calls.push(`approvals:${id ?? 'all'}`);
    return counts.approvals;
  }),
}));
vi.mock('@/lib/appointments/confirmations', () => ({
  countUnconfirmedReminders: vi.fn(async () => {
    counts.calls.push('unconfirmed');
    return counts.unconfirmed;
  }),
}));
vi.mock('@/lib/whatsapp/inbox/queries', () => ({
  countUnreadConversations: vi.fn(async () => {
    counts.calls.push('waInbox');
    return counts.waInbox;
  }),
}));

import { getNavBadgeCounts } from '../nav-badges';

beforeEach(() => {
  counts.calls = [];
  counts.inbox = 0;
  counts.waitlist = 0;
  counts.submissions = 0;
  counts.approvals = 0;
  counts.unconfirmed = 0;
  counts.waInbox = 0;
});

describe('getNavBadgeCounts', () => {
  it('reports the pending intake requests a secretary is waiting on', async () => {
    counts.submissions = 3;
    expect((await getNavBadgeCounts('SECRETARY', 'sec-1')).intakeSubmissions).toBe(3);
  });

  it('re-reads on every call — that is the whole point of polling it', async () => {
    counts.submissions = 1;
    expect((await getNavBadgeCounts('SECRETARY', 'sec-1')).intakeSubmissions).toBe(1);
    counts.submissions = 3;
    expect((await getNavBadgeCounts('SECRETARY', 'sec-1')).intakeSubmissions).toBe(3);
  });

  it('only runs the queries this role’s sidebar actually shows', async () => {
    await getNavBadgeCounts('THERAPIST', 'th-1');
    // A therapist has none of the desk counters — nothing should be queried.
    expect(counts.calls).toEqual([]);
  });

  it('a doctor pays for their approvals count, scoped to their own care team', async () => {
    await getNavBadgeCounts('DOCTOR', 'dr-1');
    expect(counts.calls).toContain('approvals:dr-1');
    expect(counts.calls).not.toContain('submissions');
  });

  it('an admin shares the secretary’s desk counters', async () => {
    // staffNavEntries gives ADMIN the secretary's sidebar, so the admin pays
    // for the desk counters and not the doctor's approvals badge.
    await getNavBadgeCounts('ADMIN', 'admin-1');
    expect(counts.calls).toContain('submissions');
    expect(counts.calls).toContain('inbox');
    expect(counts.calls.some((c) => c.startsWith('approvals'))).toBe(false);
  });

  it('always returns every key so a missing counter reads as zero, never undefined', async () => {
    expect(await getNavBadgeCounts('THERAPIST', 'th-1')).toEqual({
      inbox: 0,
      waitlist: 0,
      intakeSubmissions: 0,
      homeProgramApprovals: 0,
      unconfirmed: 0,
      waInbox: 0,
    });
  });
});
