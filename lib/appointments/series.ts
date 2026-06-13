import { AppointmentStatus, type Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import type { SeriesEditMode } from './schemas';

/**
 * Resolve the set of appointments affected by a series-edit operation
 * given a target appointment id + scope mode (Prompt 7b §4.7).
 *
 *   ONE       — exactly the target appointment.
 *   FOLLOWING — every appointment in the same series with
 *               `startsAt >= target.startsAt`. Boundary inclusive on
 *               purpose: editing "this and following" on occurrence #10
 *               of a 24-occurrence series must touch 15 rows
 *               (#10 through #24), not 14.
 *   ALL       — every appointment in the same series, regardless of
 *               time.
 *
 * Only active statuses (SCHEDULED / CONFIRMED) are returned — terminal
 * statuses (COMPLETED / CANCELLED / NO_SHOW) are never re-touched by a
 * bulk edit; they keep whatever they were transitioned to individually.
 */
export interface SeriesOccurrenceRow {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  patientId: string;
  therapistIds: string[];
  status: AppointmentStatus;
  seriesId: string | null;
}

const SELECT = {
  id: true,
  startsAt: true,
  durationMinutes: true,
  patientId: true,
  therapists: { select: { therapistId: true } },
  status: true,
  seriesId: true,
} satisfies Prisma.AppointmentSelect;

type RawOccurrence = Prisma.AppointmentGetPayload<{ select: typeof SELECT }>;

function toRow(r: RawOccurrence): SeriesOccurrenceRow {
  return {
    id: r.id,
    startsAt: r.startsAt,
    durationMinutes: r.durationMinutes,
    patientId: r.patientId,
    therapistIds: r.therapists.map((t) => t.therapistId),
    status: r.status,
    seriesId: r.seriesId,
  };
}

export async function selectSeriesOccurrences(args: {
  appointmentId: string;
  mode: SeriesEditMode;
}): Promise<SeriesOccurrenceRow[]> {
  const target = await db.appointment.findUnique({
    where: { id: args.appointmentId },
    select: { id: true, seriesId: true, startsAt: true },
  });
  if (!target) return [];

  if (args.mode === 'ONE' || !target.seriesId) {
    const row = await db.appointment.findUnique({
      where: { id: args.appointmentId },
      select: SELECT,
    });
    return row ? [toRow(row)] : [];
  }

  const where: Prisma.AppointmentWhereInput = {
    seriesId: target.seriesId,
    status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
    ...(args.mode === 'FOLLOWING' ? { startsAt: { gte: target.startsAt } } : {}),
  };

  const rows = await db.appointment.findMany({
    where,
    select: SELECT,
    orderBy: { startsAt: 'asc' },
  });
  return rows.map(toRow);
}
