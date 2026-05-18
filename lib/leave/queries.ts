import { LeaveStatus } from '@prisma/client';

import { db } from '@/lib/db';

export interface LeaveRow {
  id: string;
  userId: string;
  userFullNameEn: string;
  userFullNameAr: string;
  leaveType: 'SICK' | 'VACATION' | 'PERSONAL';
  status: LeaveStatus;
  startDate: Date;
  endDate: Date;
  reason: string | null;
  approvedByFullNameEn: string | null;
  approvedByFullNameAr: string | null;
  createdAt: Date;
}

export async function listLeavesForUser(userId: string): Promise<LeaveRow[]> {
  const rows = await db.leave.findMany({
    where: { userId },
    orderBy: { startDate: 'desc' },
    include: {
      user: { select: { fullNameEn: true, fullNameAr: true } },
      approvedBy: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map(mapRow);
}

export async function listAllLeaves(filters: { status?: LeaveStatus }): Promise<LeaveRow[]> {
  const rows = await db.leave.findMany({
    where: filters.status ? { status: filters.status } : undefined,
    orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    include: {
      user: { select: { fullNameEn: true, fullNameAr: true } },
      approvedBy: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map(mapRow);
}

/**
 * Approved leaves overlapping a date range, used by the calendar to
 * render the "On leave" blocks per therapist column. Pure-read.
 */
export async function listApprovedLeavesInRange(
  from: Date,
  to: Date,
): Promise<
  Array<{ id: string; userId: string; startDate: Date; endDate: Date; leaveType: string }>
> {
  return db.leave.findMany({
    where: {
      status: LeaveStatus.APPROVED,
      startDate: { lte: to },
      endDate: { gte: from },
    },
    select: { id: true, userId: true, startDate: true, endDate: true, leaveType: true },
    orderBy: { startDate: 'asc' },
  });
}

function mapRow(r: {
  id: string;
  userId: string;
  user: { fullNameEn: string; fullNameAr: string };
  leaveType: 'SICK' | 'VACATION' | 'PERSONAL';
  status: LeaveStatus;
  startDate: Date;
  endDate: Date;
  reason: string | null;
  approvedBy: { fullNameEn: string; fullNameAr: string } | null;
  createdAt: Date;
}): LeaveRow {
  return {
    id: r.id,
    userId: r.userId,
    userFullNameEn: r.user.fullNameEn,
    userFullNameAr: r.user.fullNameAr,
    leaveType: r.leaveType,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    reason: r.reason,
    approvedByFullNameEn: r.approvedBy?.fullNameEn ?? null,
    approvedByFullNameAr: r.approvedBy?.fullNameAr ?? null,
    createdAt: r.createdAt,
  };
}
