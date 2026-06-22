import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, count } = vi.hoisted(() => ({
  findMany: vi.fn(async (_args: { where: Record<string, unknown> }) => [] as unknown[]),
  count: vi.fn(async (_args: { where: Record<string, unknown> }) => 0),
}));

vi.mock('@/lib/db', () => ({ db: { exercise: { findMany, count } } }));

import { listExercises } from '../queries';

beforeEach(() => {
  findMany.mockClear();
  count.mockClear();
});

describe('exercise library search (QA retest #12)', () => {
  it('filters by name (EN/AR) AND keeps the other filters', async () => {
    await listExercises({ search: 'knee', category: 'STRENGTH' });
    const where = findMany.mock.calls[0]![0].where;
    // Base + category filters are preserved alongside the search OR.
    expect(where.replacedById).toBeNull();
    expect(where.active).toBe(true);
    expect(where.category).toBe('STRENGTH');
    const or = (where.OR ?? []) as Array<Record<string, { contains?: string }>>;
    const fields = or.flatMap((c) => Object.keys(c));
    expect(fields).toEqual(expect.arrayContaining(['nameEn', 'nameAr']));
    // every OR branch searches for the term
    expect(JSON.stringify(or)).toContain('knee');
  });

  it('omits the OR clause when no search term is given', async () => {
    await listExercises({ category: 'MOBILITY' });
    const where = findMany.mock.calls[0]![0].where;
    expect(where.OR).toBeUndefined();
    expect(where.category).toBe('MOBILITY');
  });
});
