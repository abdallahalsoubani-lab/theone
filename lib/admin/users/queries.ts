import { UserRole, type Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import type { UserListFilters } from './schemas';

export interface UserListRow {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  email: string | null;
  phone: string;
  role: UserRole;
  archived: boolean;
  specialties: { id: string; nameEn: string; nameAr: string }[];
  passwordChangedAt: Date | null;
}

export async function listUsers(
  filters: UserListFilters,
): Promise<{ rows: UserListRow[]; total: number }> {
  const where: Prisma.UserWhereInput = {
    role: filters.role ? filters.role : { not: UserRole.PATIENT },
    ...(filters.status === 'active' ? { deletedAt: null } : {}),
    ...(filters.status === 'archived' ? { deletedAt: { not: null } } : {}),
    ...(filters.specialtyId ? { specialties: { some: { specialtyId: filters.specialtyId } } } : {}),
    ...(filters.search
      ? {
          OR: [
            { fullNameEn: { contains: filters.search, mode: 'insensitive' } },
            { fullNameAr: { contains: filters.search } },
            { email: { contains: filters.search, mode: 'insensitive' } },
            { phone: { contains: filters.search } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      orderBy: { fullNameEn: 'asc' },
      include: {
        specialties: {
          include: { specialty: { select: { id: true, nameEn: true, nameAr: true } } },
        },
      },
    }),
    db.user.count({ where }),
  ]);

  return {
    rows: rows.map((u) => ({
      id: u.id,
      fullNameEn: u.fullNameEn,
      fullNameAr: u.fullNameAr,
      email: u.email,
      phone: u.phone,
      role: u.role,
      archived: u.deletedAt !== null,
      passwordChangedAt: u.passwordChangedAt,
      specialties: u.specialties.map((s) => s.specialty),
    })),
    total,
  };
}

export async function getUserById(id: string) {
  return db.user.findUnique({
    where: { id },
    include: {
      specialties: { include: { specialty: true } },
    },
  });
}

export async function countActiveAdmins(): Promise<number> {
  return db.user.count({ where: { role: UserRole.ADMIN, deletedAt: null } });
}
