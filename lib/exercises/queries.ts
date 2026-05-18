import 'server-only';

import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

export interface ExerciseRow {
  id: string;
  nameEn: string;
  nameAr: string;
  category: string;
  anatomicalRegion: string;
  descriptionEn: string;
  descriptionAr: string;
  contraindications: string | null;
  defaultInstructionEn: string | null;
  defaultInstructionAr: string | null;
  videoUrl: string | null;
  imageUrl: string | null;
  version: number;
  active: boolean;
  replacedById: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ListArgs {
  search?: string;
  category?: string;
  anatomicalRegion?: string;
  showArchived?: boolean;
  hasVideo?: boolean;
  page?: number;
  pageSize?: number;
}

/**
 * Library list. Filters out superseded versions (replacedById !== null)
 * and either active-only or archived-only based on showArchived.
 */
export async function listExercises(args: ListArgs = {}): Promise<{
  rows: ExerciseRow[];
  total: number;
}> {
  const where: Prisma.ExerciseWhereInput = {
    replacedById: null,
    active: args.showArchived ? false : true,
  };
  if (args.category) where.category = args.category;
  if (args.anatomicalRegion) where.anatomicalRegion = args.anatomicalRegion;
  if (args.hasVideo) where.videoUrl = { not: null };
  if (args.search) {
    where.OR = [
      { nameEn: { contains: args.search, mode: 'insensitive' } },
      { nameAr: { contains: args.search, mode: 'insensitive' } },
      { descriptionEn: { contains: args.search, mode: 'insensitive' } },
      { descriptionAr: { contains: args.search, mode: 'insensitive' } },
    ];
  }
  const page = args.page ?? 1;
  const pageSize = args.pageSize ?? 20;
  const [rows, total] = await Promise.all([
    db.exercise.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.exercise.count({ where }),
  ]);
  return { rows, total };
}

export async function getExerciseById(id: string): Promise<ExerciseRow | null> {
  return db.exercise.findUnique({ where: { id } });
}
