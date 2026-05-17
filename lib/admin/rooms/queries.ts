import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import type { RoomListFilters } from './schemas';

export interface RoomListRow {
  id: string;
  name: string;
  active: boolean;
  futureAppointments: number;
}

export async function listRooms(
  filters: RoomListFilters,
): Promise<{ rows: RoomListRow[]; total: number }> {
  const where: Prisma.RoomWhereInput = {
    ...(filters.status === 'active' ? { active: true } : {}),
    ...(filters.status === 'inactive' ? { active: false } : {}),
    ...(filters.search ? { name: { contains: filters.search, mode: 'insensitive' } } : {}),
  };

  const [rows, total] = await Promise.all([
    db.room.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        _count: {
          select: {
            appointments: { where: { startsAt: { gte: new Date() } } },
          },
        },
      },
    }),
    db.room.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      active: r.active,
      futureAppointments: r._count.appointments,
    })),
    total,
  };
}

export async function getRoomById(id: string) {
  return db.room.findUnique({ where: { id } });
}

/**
 * Active rooms — consumed by Prompt 7's appointment creation form. Exported
 * so any authenticated staff role can call it (rooms.read is broad — see
 * Prompt 5 §4.7).
 */
export async function listActiveRooms() {
  return db.room.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}
