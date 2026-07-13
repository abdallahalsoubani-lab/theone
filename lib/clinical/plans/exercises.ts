import 'server-only';

import { db } from '@/lib/db';

/**
 * Lean Exercise list for the plan-form + home-program selectors. Prompt 10
 * builds the full Exercise Library UI (categories, anatomical regions,
 * contraindications, video upload); here we just need the bare minimum
 * to render a `<select>` of exercises.
 *
 * Only ACTIVE, un-superseded versions are offered for NEW references
 * (QA 6.3) — mirroring the library filter in lib/exercises/queries.ts.
 * Edit surfaces use `listExerciseOptionsIncluding` so items that already
 * reference an archived/replaced version keep resolving in the select.
 */
export interface ExerciseOption {
  id: string;
  nameEn: string;
  nameAr: string;
  category: string;
  /** True for archived (active=false) or superseded (replacedById set)
   *  versions surfaced only because an existing row references them. */
  archived: boolean;
}

const OPTION_SELECT = {
  id: true,
  nameEn: true,
  nameAr: true,
  category: true,
  active: true,
  replacedById: true,
} as const;

type OptionRow = {
  id: string;
  nameEn: string;
  nameAr: string;
  category: string;
  active: boolean;
  replacedById: string | null;
};

function shapeOption(row: OptionRow): ExerciseOption {
  return {
    id: row.id,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    category: row.category,
    archived: !row.active || row.replacedById !== null,
  };
}

/** Pickable catalog: current (un-replaced) active exercise versions only. */
export async function listExerciseOptions(): Promise<ExerciseOption[]> {
  const rows = await db.exercise.findMany({
    where: { replacedById: null, active: true },
    orderBy: { nameEn: 'asc' },
    select: OPTION_SELECT,
  });
  return rows.map(shapeOption);
}

/**
 * Pickable catalog PLUS the (possibly archived/superseded) exercises already
 * referenced by the rows being edited — so an existing item keeps rendering
 * its historical version instead of silently snapping to another exercise.
 */
export async function listExerciseOptionsIncluding(
  referencedIds: ReadonlyArray<string>,
): Promise<ExerciseOption[]> {
  const ids = [...new Set(referencedIds)].filter(Boolean);
  if (ids.length === 0) return listExerciseOptions();
  const rows = await db.exercise.findMany({
    where: {
      OR: [{ replacedById: null, active: true }, { id: { in: ids } }],
    },
    orderBy: { nameEn: 'asc' },
    select: OPTION_SELECT,
  });
  return rows.map(shapeOption);
}
