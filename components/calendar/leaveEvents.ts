import type { View } from 'react-big-calendar';

/**
 * Approved-leave → react-big-calendar `backgroundEvents` mapping
 * (Prompt 11 §4.1.5, extracted + view-scoped in Prompt 55 §1).
 *
 * Leave bounds are `@db.Date` columns (UTC-midnight instants encoding a
 * calendar day). Each block is rebuilt as a LOCAL day span from the UTC date
 * parts so the overlay covers the right grid days on any machine — the same
 * convention the events use for clinic-wall positioning.
 *
 * View scoping (the Prompt 55 fix): day view has per-clinician resource
 * lanes, so every block lands in its owner's column. Week view has NO lanes —
 * a block there would wash the whole day column for every clinician — so
 * blocks render only when the calendar is single-clinician (the therapist
 * board passes its own leaves and no resources). Month/agenda ignore
 * backgroundEvents entirely.
 *
 * Pure (type-only rbc import) so it unit-tests without the calendar runtime.
 */
export interface LeaveBlock {
  id: string;
  userId: string;
  startDate: Date;
  endDate: Date;
}

export interface LeaveBackgroundEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resourceId: string;
  leave: true;
}

export function leaveBackgroundEvents(
  leaves: LeaveBlock[] | undefined,
  view: View,
  opts: { onLeaveLabel: string; hasResourceLanes: boolean },
): LeaveBackgroundEvent[] {
  if (!leaves || leaves.length === 0) return [];
  const visible = view === 'day' || (view === 'week' && !opts.hasResourceLanes);
  if (!visible) return [];
  return leaves.map((l) => {
    const start = new Date(
      l.startDate.getUTCFullYear(),
      l.startDate.getUTCMonth(),
      l.startDate.getUTCDate(),
      0,
      0,
      0,
      0,
    );
    const end = new Date(
      l.endDate.getUTCFullYear(),
      l.endDate.getUTCMonth(),
      l.endDate.getUTCDate(),
      23,
      59,
      59,
      999,
    );
    return {
      id: `leave-${l.id}`,
      title: opts.onLeaveLabel,
      start,
      end,
      resourceId: l.userId,
      leave: true as const,
    };
  });
}
