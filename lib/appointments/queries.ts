import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import type { AppointmentListFilters } from './schemas';

export interface CalendarAppointment {
  id: string;
  patientId: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  therapistId: string;
  therapistFullNameEn: string;
  therapistFullNameAr: string;
  roomId: string | null;
  roomName: string | null;
  startsAt: Date;
  durationMinutes: number;
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  notes: string | null;
}

/**
 * Calendar-shaped query. Returns lean shape suitable for `react-big-calendar`
 * resource events. Caller filters by date range + optional therapist set.
 */
export async function listAppointmentsForCalendar(
  filters: AppointmentListFilters,
): Promise<CalendarAppointment[]> {
  const where: Prisma.AppointmentWhereInput = {
    startsAt: { gte: filters.from, lte: filters.to },
    ...(filters.therapistIds && filters.therapistIds.length > 0
      ? { therapistId: { in: filters.therapistIds } }
      : {}),
    ...(filters.patientId ? { patientId: filters.patientId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  const rows = await db.appointment.findMany({
    where,
    orderBy: { startsAt: 'asc' },
    include: {
      patient: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      therapist: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      room: { select: { id: true, name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient.id,
    patientFullNameEn: r.patient.fullNameEn,
    patientFullNameAr: r.patient.fullNameAr,
    therapistId: r.therapist.id,
    therapistFullNameEn: r.therapist.fullNameEn,
    therapistFullNameAr: r.therapist.fullNameAr,
    roomId: r.room?.id ?? null,
    roomName: r.room?.name ?? null,
    startsAt: r.startsAt,
    durationMinutes: r.durationMinutes,
    status: r.status,
    notes: r.notes,
  }));
}

export async function getAppointmentById(id: string) {
  return db.appointment.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, fullNameEn: true, fullNameAr: true, phone: true } },
      therapist: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      room: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
    },
  });
}

/**
 * Used by the appointment form's "patient picker" to populate the searchable
 * select. Returns active patients only, name + phone for display.
 */
export async function listActivePatientsBrief(limit = 200) {
  return db.user.findMany({
    where: { role: 'PATIENT', deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true, phone: true },
    orderBy: { fullNameEn: 'asc' },
    take: limit,
  });
}

/**
 * Active clinical staff (therapists + doctors) — fills the resource column
 * list on the calendar and the therapist picker in the appointment form.
 */
export async function listActiveClinicians() {
  return db.user.findMany({
    where: { role: { in: ['THERAPIST', 'DOCTOR'] }, deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true, role: true },
    orderBy: { fullNameEn: 'asc' },
  });
}
