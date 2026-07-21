import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * July change request #7 — cancelled appointments must not render on the
 * calendar grid. The exclusion lives at the query layer
 * (listAppointmentsForCalendar), not in CSS. The dedicated Cancelled view
 * (listCancelledAppointments) is unchanged and still returns them.
 */

const calendarFindMany = vi.fn(async (_arg: unknown) => []);
const cancelledFindMany = vi.fn(async (_arg: unknown) => []);
const cancelledCount = vi.fn(async (_arg: unknown) => 0);

vi.mock('@/lib/db', () => ({
  db: {
    appointment: {
      // Route by whether an explicit CANCELLED-only where is present so the
      // calendar query and the Cancelled-view query share the mock cleanly.
      findMany: (arg: { where?: { status?: unknown } }) =>
        arg?.where?.status === 'CANCELLED' ? cancelledFindMany(arg) : calendarFindMany(arg),
      count: (arg: unknown) => cancelledCount(arg),
    },
  },
}));

import { listAppointmentsForCalendar, listCancelledAppointments } from '../queries';

const range = { from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-07-02T00:00:00Z') };

describe('listAppointmentsForCalendar — cancelled excluded from the grid', () => {
  beforeEach(() => {
    calendarFindMany.mockClear();
    cancelledFindMany.mockClear();
  });

  it('excludes CANCELLED (but nothing else) when no explicit status filter is given', async () => {
    await listAppointmentsForCalendar(range);
    // `{ not: 'CANCELLED' }` still admits NO_SHOW, COMPLETED, IN_PROGRESS, etc.
    expect(calendarFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: 'CANCELLED' } }) }),
    );
  });

  it('honours an explicit status filter as an escape hatch', async () => {
    await listAppointmentsForCalendar({ ...range, status: 'CANCELLED' });
    expect(cancelledFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });
});

describe('listCancelledAppointments — the Cancelled view still returns them', () => {
  beforeEach(() => {
    cancelledFindMany.mockClear();
    cancelledCount.mockClear();
  });

  it('queries by status = CANCELLED', async () => {
    await listCancelledAppointments({
      filters: { page: 1, pageSize: 20 },
      canSeePhone: true,
    });
    expect(cancelledFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });
});
