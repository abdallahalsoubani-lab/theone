import { AppointmentStatus, type Leave } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Conflict scan (Prompt 11 §4.1.4). After a leave is approved the
 * scheduler may already hold appointments that fall inside the leave
 * window — those become inbox items for the Secretary so they can
 * reassign or cancel.
 *
 * `THERAPIST_ON_LEAVE` was already wired in Prompt 7's conflict engine,
 * which prevents NEW appointments from being booked into the window.
 * This scan handles the retrospective case.
 */

export interface LeaveConflictRow {
  appointmentId: string;
  patientId: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  startsAt: Date;
  durationMinutes: number;
}

/**
 * Find active (non-terminal) appointments for the leave-taker whose
 * `startsAt` date falls within the leave window. The leave columns
 * are stored as DATE (no time part) so we expand each end to a full
 * calendar day in UTC for the overlap check.
 */
export async function scanLeaveConflicts(
  leave: Pick<Leave, 'userId' | 'startDate' | 'endDate'>,
): Promise<LeaveConflictRow[]> {
  const start = new Date(leave.startDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(leave.endDate);
  end.setUTCHours(23, 59, 59, 999);

  const rows = await db.appointment.findMany({
    where: {
      therapists: { some: { therapistId: leave.userId } },
      status: {
        in: [
          AppointmentStatus.SCHEDULED,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.IN_PROGRESS,
        ],
      },
      startsAt: { gte: start, lte: end },
    },
    select: {
      id: true,
      startsAt: true,
      durationMinutes: true,
      patient: { select: { id: true, fullNameEn: true, fullNameAr: true } },
    },
    orderBy: { startsAt: 'asc' },
  });

  return rows.map((r) => ({
    appointmentId: r.id,
    patientId: r.patient.id,
    patientFullNameEn: r.patient.fullNameEn,
    patientFullNameAr: r.patient.fullNameAr,
    startsAt: r.startsAt,
    durationMinutes: r.durationMinutes,
  }));
}
