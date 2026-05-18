import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  const state = {
    items: [] as Array<{
      id: string;
      patientId: string;
      active: boolean;
      daysOfWeek: number[];
      createdAt: Date;
    }>,
    completions: [] as Array<{ itemId: string; scheduledDate: Date }>,
  };
  return {
    __state: state,
    db: {
      homeProgramItem: {
        findMany: vi.fn(async ({ where }: { where: { patientId: string; active: boolean } }) =>
          state.items.filter((i) => i.patientId === where.patientId && i.active === where.active),
        ),
      },
      homeProgramCompletion: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              item: { patientId: string; active: boolean };
              scheduledDate: { gte: Date; lte: Date };
            };
          }) =>
            state.completions.filter((c) => {
              const item = state.items.find((i) => i.id === c.itemId);
              if (!item) return false;
              if (item.patientId !== where.item.patientId) return false;
              if (item.active !== where.item.active) return false;
              return (
                c.scheduledDate.getTime() >= where.scheduledDate.gte.getTime() &&
                c.scheduledDate.getTime() <= where.scheduledDate.lte.getTime()
              );
            }),
        ),
      },
    },
  };
});

import * as dbModule from '@/lib/db';
import { calculateCompliance, calculateStreak } from '../calculate';

const state = (
  dbModule as unknown as {
    __state: {
      items: Array<{
        id: string;
        patientId: string;
        active: boolean;
        daysOfWeek: number[];
        createdAt: Date;
      }>;
      completions: Array<{ itemId: string; scheduledDate: Date }>;
    };
  }
).__state;

beforeEach(() => {
  state.items.length = 0;
  state.completions.length = 0;
});

function daysAgo(n: number): Date {
  const d = new Date('2026-05-20T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

const FIXED_NOW = new Date('2026-05-20T12:00:00Z');

describe('calculateCompliance', () => {
  it('returns rate=null when there are no active items', async () => {
    const r = await calculateCompliance({
      patientId: 'p-1',
      windowDays: 7,
      now: FIXED_NOW,
    });
    expect(r).toEqual({ rate: null, expected: 0, completed: 0, overdue: 0 });
  });

  it('returns 1.0 when every scheduled occurrence is completed', async () => {
    // Daily item created 14 days ago — over the 7-day window every day is
    // a scheduled occurrence.
    state.items.push({
      id: 'i-1',
      patientId: 'p-1',
      active: true,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      createdAt: daysAgo(14),
    });
    for (let i = 0; i < 7; i++) {
      state.completions.push({ itemId: 'i-1', scheduledDate: daysAgo(i) });
    }
    const r = await calculateCompliance({
      patientId: 'p-1',
      windowDays: 7,
      now: FIXED_NOW,
    });
    expect(r.expected).toBe(7);
    expect(r.completed).toBe(7);
    expect(r.rate).toBe(1);
  });

  it('returns 0.5 when half of scheduled days are completed', async () => {
    state.items.push({
      id: 'i-1',
      patientId: 'p-1',
      active: true,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      createdAt: daysAgo(14),
    });
    // Even-offset days only.
    for (let i = 0; i < 7; i += 2) {
      state.completions.push({ itemId: 'i-1', scheduledDate: daysAgo(i) });
    }
    const r = await calculateCompliance({
      patientId: 'p-1',
      windowDays: 7,
      now: FIXED_NOW,
    });
    // Completed 4 of 7 (offsets 0, 2, 4, 6).
    expect(r.expected).toBe(7);
    expect(r.completed).toBe(4);
    expect(r.rate).toBeCloseTo(4 / 7, 4);
  });

  it('counts overdue occurrences in the last 2 days only', async () => {
    state.items.push({
      id: 'i-1',
      patientId: 'p-1',
      active: true,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      createdAt: daysAgo(14),
    });
    // Completed only day 0 (today); days 1 + 2 are overdue.
    state.completions.push({ itemId: 'i-1', scheduledDate: daysAgo(0) });
    const r = await calculateCompliance({
      patientId: 'p-1',
      windowDays: 7,
      now: FIXED_NOW,
    });
    expect(r.overdue).toBe(2);
  });

  it("only counts occurrences from the item's createdAt forward", async () => {
    // Daily item created 3 days ago — 7-day window has only 4 scheduled
    // days (today, yesterday, day-2, day-3).
    state.items.push({
      id: 'i-1',
      patientId: 'p-1',
      active: true,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      createdAt: daysAgo(3),
    });
    const r = await calculateCompliance({
      patientId: 'p-1',
      windowDays: 7,
      now: FIXED_NOW,
    });
    expect(r.expected).toBe(4);
  });

  it('skips paused items', async () => {
    state.items.push({
      id: 'paused',
      patientId: 'p-1',
      active: false,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      createdAt: daysAgo(30),
    });
    const r = await calculateCompliance({
      patientId: 'p-1',
      windowDays: 7,
      now: FIXED_NOW,
    });
    expect(r.rate).toBeNull();
    expect(r.expected).toBe(0);
  });
});

describe('calculateStreak', () => {
  it('returns 0 when no items exist', async () => {
    const r = await calculateStreak({ patientId: 'p-1', now: FIXED_NOW });
    expect(r).toBe(0);
  });

  it('counts consecutive scheduled days with at least one completion', async () => {
    state.items.push({
      id: 'i-1',
      patientId: 'p-1',
      active: true,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      createdAt: daysAgo(30),
    });
    // Completions for days 0..4 (5 days in a row).
    for (let i = 0; i <= 4; i++) {
      state.completions.push({ itemId: 'i-1', scheduledDate: daysAgo(i) });
    }
    const r = await calculateStreak({ patientId: 'p-1', now: FIXED_NOW });
    expect(r).toBe(5);
  });

  it('stops counting at the first missed scheduled day', async () => {
    state.items.push({
      id: 'i-1',
      patientId: 'p-1',
      active: true,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      createdAt: daysAgo(30),
    });
    // Today + yesterday completed; day-2 missed; day-3 completed (doesn't
    // help the streak because day-2 broke it).
    state.completions.push({ itemId: 'i-1', scheduledDate: daysAgo(0) });
    state.completions.push({ itemId: 'i-1', scheduledDate: daysAgo(1) });
    state.completions.push({ itemId: 'i-1', scheduledDate: daysAgo(3) });
    const r = await calculateStreak({ patientId: 'p-1', now: FIXED_NOW });
    expect(r).toBe(2);
  });
});
