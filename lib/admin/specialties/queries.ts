import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import type { SpecialtyListFilters } from './schemas';

export interface SpecialtyListRow {
  id: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  active: boolean;
  usersCount: number;
}

export async function listSpecialties(
  filters: SpecialtyListFilters,
): Promise<{ rows: SpecialtyListRow[]; total: number }> {
  const where: Prisma.SpecialtyWhereInput = {
    ...(filters.status === 'active' ? { active: true } : {}),
    ...(filters.status === 'inactive' ? { active: false } : {}),
    ...(filters.search
      ? {
          OR: [
            { nameEn: { contains: filters.search, mode: 'insensitive' } },
            { nameAr: { contains: filters.search } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.specialty.findMany({
      where,
      include: { _count: { select: { users: true } } },
      orderBy: { nameEn: 'asc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.specialty.count({ where }),
  ]);

  return {
    rows: rows.map((s) => ({
      id: s.id,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      description: s.description,
      active: s.active,
      usersCount: s._count.users,
    })),
    total,
  };
}

export async function getSpecialtyById(id: string) {
  return db.specialty.findUnique({ where: { id } });
}
