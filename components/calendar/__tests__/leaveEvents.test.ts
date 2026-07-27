import { describe, expect, it } from 'vitest';

import { leaveBackgroundEvents } from '../leaveEvents';

/**
 * Prompt 55 §1 — the serialized shape the gray leave columns render from,
 * and the view scoping that keeps a clinician's leave from washing the whole
 * shared week column.
 */

const label = 'في إجازة';

const leave = {
  id: 'l1',
  userId: 'th-1',
  // @db.Date columns arrive as UTC-midnight instants.
  startDate: new Date('2026-08-03T00:00:00.000Z'),
  endDate: new Date('2026-08-04T00:00:00.000Z'),
};

describe('leaveBackgroundEvents', () => {
  it('day view → one block per leave, keyed to the clinician resource lane', () => {
    const events = leaveBackgroundEvents([leave], 'day', {
      onLeaveLabel: label,
      hasResourceLanes: true,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'leave-l1',
      title: label,
      resourceId: 'th-1',
      leave: true,
    });
  });

  it('rebuilds the UTC date parts as LOCAL day spans (full-column coverage)', () => {
    const [e] = leaveBackgroundEvents([leave], 'day', {
      onLeaveLabel: label,
      hasResourceLanes: true,
    });
    // Start: local midnight on the leave's first day.
    expect([e!.start.getFullYear(), e!.start.getMonth(), e!.start.getDate()]).toEqual([2026, 7, 3]);
    expect([e!.start.getHours(), e!.start.getMinutes()]).toEqual([0, 0]);
    // End: local end-of-day on the leave's last day (inclusive range).
    expect([e!.end.getFullYear(), e!.end.getMonth(), e!.end.getDate()]).toEqual([2026, 7, 4]);
    expect([e!.end.getHours(), e!.end.getMinutes(), e!.end.getSeconds()]).toEqual([23, 59, 59]);
  });

  it('week view with resource lanes (shared calendar) → NO blocks: a lane-less block would gray the whole day for every clinician', () => {
    expect(
      leaveBackgroundEvents([leave], 'week', { onLeaveLabel: label, hasResourceLanes: true }),
    ).toEqual([]);
  });

  it('week view WITHOUT lanes (single-clinician board) → blocks render (the whole column is legitimately theirs)', () => {
    const events = leaveBackgroundEvents([leave], 'week', {
      onLeaveLabel: label,
      hasResourceLanes: false,
    });
    expect(events).toHaveLength(1);
  });

  it('month and agenda → never any blocks', () => {
    for (const view of ['month', 'agenda'] as const) {
      expect(
        leaveBackgroundEvents([leave], view, { onLeaveLabel: label, hasResourceLanes: true }),
      ).toEqual([]);
      expect(
        leaveBackgroundEvents([leave], view, { onLeaveLabel: label, hasResourceLanes: false }),
      ).toEqual([]);
    }
  });

  it('undefined / empty input → empty output', () => {
    expect(
      leaveBackgroundEvents(undefined, 'day', { onLeaveLabel: label, hasResourceLanes: true }),
    ).toEqual([]);
    expect(
      leaveBackgroundEvents([], 'day', { onLeaveLabel: label, hasResourceLanes: true }),
    ).toEqual([]);
  });
});
