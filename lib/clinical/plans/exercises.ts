import 'server-only';

import { db } from '@/lib/db';

/**
 * Lean Exercise list for the plan-form selector. Prompt 10 builds the
 * full Exercise Library UI (categories, anatomical regions,
 * contraindications, video upload); here we just need the bare minimum
 * to render a `<select>` of seeded exercises plus a "Custom — notes only"
 * fallback row.
 */
export interface ExerciseOption {
  id: string;
  nameEn: string;
  nameAr: string;
  category: string;
}

export async function listExerciseOptions(): Promise<ExerciseOption[]> {
  return db.exercise.findMany({
    orderBy: { nameEn: 'asc' },
    select: { id: true, nameEn: true, nameAr: true, category: true },
  });
}
