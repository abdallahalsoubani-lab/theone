import { CustomQuestionAppliesTo, type CustomQuestionType, type Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import type { CustomQuestionOption } from './schemas';

export interface CustomQuestionRow {
  id: string;
  nameEn: string;
  nameAr: string;
  type: CustomQuestionType;
  appliesTo: CustomQuestionAppliesTo;
  required: boolean;
  active: boolean;
  displayOrder: number;
  options: CustomQuestionOption[];
  answerCount: number;
}

interface ListFilters {
  scope: CustomQuestionAppliesTo; // ADULT, PEDIATRIC — BOTH appears in either
}

export async function listCustomQuestions(filters: ListFilters): Promise<CustomQuestionRow[]> {
  const where: Prisma.IntakeCustomQuestionWhereInput = {
    appliesTo:
      filters.scope === CustomQuestionAppliesTo.BOTH
        ? undefined
        : { in: [filters.scope, CustomQuestionAppliesTo.BOTH] },
  };

  const rows = await db.intakeCustomQuestion.findMany({
    where,
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: { _count: { select: { answers: true } } },
  });

  return rows.map((q) => ({
    id: q.id,
    nameEn: q.nameEn,
    nameAr: q.nameAr,
    type: q.type,
    appliesTo: q.appliesTo,
    required: q.required,
    active: q.active,
    displayOrder: q.displayOrder,
    options: parseOptions(q.options),
    answerCount: q._count.answers,
  }));
}

export async function getCustomQuestionById(id: string) {
  const row = await db.intakeCustomQuestion.findUnique({
    where: { id },
    include: { _count: { select: { answers: true } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    type: row.type,
    appliesTo: row.appliesTo,
    required: row.required,
    active: row.active,
    displayOrder: row.displayOrder,
    options: parseOptions(row.options),
    answerCount: row._count.answers,
  };
}

function parseOptions(raw: unknown): CustomQuestionOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o, i) => {
      if (!o || typeof o !== 'object') return null;
      const rec = o as Record<string, unknown>;
      const valueEn = String(rec.valueEn ?? '');
      const valueAr = String(rec.valueAr ?? '');
      const value = typeof rec.value === 'string' && rec.value ? rec.value : `opt-${i}`;
      if (!valueEn || !valueAr) return null;
      return { value, valueEn, valueAr };
    })
    .filter((x): x is CustomQuestionOption => x !== null);
}

/** Returns the set of option values that have at least one answer referencing them. */
export async function listSelectedOptionValues(questionId: string): Promise<Set<string>> {
  const answers = await db.intakeCustomAnswer.findMany({
    where: { questionId },
    select: { valueOptions: true },
  });
  const used = new Set<string>();
  for (const a of answers) {
    if (Array.isArray(a.valueOptions)) {
      for (const v of a.valueOptions) used.add(String(v));
    }
  }
  return used;
}
