import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * QA 6.3 — the shared exercise picker (plan form + home-program builder)
 * must offer only ACTIVE, un-superseded versions, while edit surfaces merge
 * in the versions their rows already reference so historical items keep
 * resolving.
 */

const { findMany } = vi.hoisted(() => ({
  findMany: vi.fn(
    async (_args: { where?: Record<string, unknown> }) =>
      [
        {
          id: 'ex-1',
          nameEn: 'Squat',
          nameAr: 'قرفصاء',
          category: 'STRENGTH',
          version: 2,
          active: true,
          replacedById: null,
        },
        {
          id: 'ex-old',
          nameEn: 'Old Squat',
          nameAr: 'قرفصاء قديمة',
          category: 'STRENGTH',
          version: 1,
          active: false,
          replacedById: 'ex-1',
        },
      ] as unknown[],
  ),
}));

vi.mock('@/lib/db', () => ({ db: { exercise: { findMany } } }));

import { listExerciseOptions, listExerciseOptionsIncluding } from '../plans/exercises';

beforeEach(() => {
  findMany.mockClear();
});

describe('listExerciseOptions (QA 6.3)', () => {
  it('filters to active, un-replaced versions only', async () => {
    await listExerciseOptions();
    const where = findMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where.replacedById).toBeNull();
    expect(where.active).toBe(true);
  });

  it('flags archived/superseded rows so the UI can label them', async () => {
    const options = await listExerciseOptions();
    expect(options.find((o) => o.id === 'ex-1')?.archived).toBe(false);
    expect(options.find((o) => o.id === 'ex-old')?.archived).toBe(true);
  });
});

describe('listExerciseOptionsIncluding (QA 6.3 edit surfaces)', () => {
  it('ORs the active catalog with the referenced ids (deduped)', async () => {
    await listExerciseOptionsIncluding(['ex-old', 'ex-old', 'ex-1']);
    const where = findMany.mock.calls[0]![0].where as {
      OR: Array<Record<string, unknown>>;
    };
    expect(where.OR).toEqual([
      { replacedById: null, active: true },
      { id: { in: ['ex-old', 'ex-1'] } },
    ]);
  });

  it('falls back to the plain active filter when nothing is referenced', async () => {
    await listExerciseOptionsIncluding([]);
    const where = findMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where.OR).toBeUndefined();
    expect(where.replacedById).toBeNull();
    expect(where.active).toBe(true);
  });
});

describe('version visibility (Prompt 36 — D-23 note)', () => {
  it('options carry the version number so pickers can label "v2" etc.', async () => {
    const options = await listExerciseOptionsIncluding(['ex-old']);
    const current = options.find((o) => o.id === 'ex-1');
    const superseded = options.find((o) => o.id === 'ex-old');
    expect(current).toMatchObject({ version: 2, archived: false });
    expect(superseded).toMatchObject({ version: 1, archived: true });
  });

  it('the plain picker filters at the QUERY layer: a v1-archived + v2-active chain yields only the v2 row', async () => {
    await listExerciseOptions();
    // The where clause is the guarantee — active, un-replaced rows only, so a
    // chain contributes exactly its current version (the DB does the dedupe).
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { replacedById: null, active: true },
      }),
    );
  });
});
