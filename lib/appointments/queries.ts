import { AppointmentStatus, type CancellationCategory, type Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import type { AppointmentListFilters, CancelledAppointmentFilters } from './schemas';

export interface PersonRef {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

export interface CalendarAppointment {
  id: string;
  patientId: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  /** All therapists on this session (Prompt 20) — the calendar renders the
   *  appointment in each one's resource column. */
  therapists: PersonRef[];
  roomId: string | null;
  roomName: string | null;
  startsAt: Date;
  durationMinutes: number;
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  notes: string | null;
  seriesId: string | null;
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
      ? { therapists: { some: { therapistId: { in: filters.therapistIds } } } }
      : {}),
    ...(filters.patientId ? { patientId: filters.patientId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  const rows = await db.appointment.findMany({
    where,
    orderBy: { startsAt: 'asc' },
    include: {
      patient: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      therapists: {
        orderBy: { createdAt: 'asc' },
        include: { therapist: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      },
      room: { select: { id: true, name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient.id,
    patientFullNameEn: r.patient.fullNameEn,
    patientFullNameAr: r.patient.fullNameAr,
    therapists: r.therapists.map((t) => t.therapist),
    roomId: r.room?.id ?? null,
    roomName: r.room?.name ?? null,
    startsAt: r.startsAt,
    durationMinutes: r.durationMinutes,
    status: r.status,
    notes: r.notes,
    seriesId: r.seriesId,
  }));
}

export async function getAppointmentById(id: string) {
  return db.appointment.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, fullNameEn: true, fullNameAr: true, phone: true } },
      therapists: {
        orderBy: { createdAt: 'asc' },
        include: { therapist: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      },
      room: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
    },
  });
}

/**
 * Used by the appointment form's "patient picker" to populate the searchable
 * select. Returns active patients only, name + phone for display. Phone is
 * nulled out for Doctor viewers (Prompt 15 §1) — the picker shows name only
 * for them; Secretary/Admin keep the phone to disambiguate same-name patients.
 */
export async function listActivePatientsBrief(limit = 200) {
  const { viewerCanSeePatientPhone } = await import('@/lib/patients/access');
  const canSeePhone = await viewerCanSeePatientPhone();
  const rows = await db.user.findMany({
    where: { role: 'PATIENT', deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true, phone: true },
    orderBy: { fullNameEn: 'asc' },
    take: limit,
  });
  return rows.map((r) => ({ ...r, phone: canSeePhone ? r.phone : null }));
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

export interface CancelledAppointmentRow {
  id: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  /** Null for Doctor viewers — phone hidden (Prompt 15 §1). */
  patientPhone: string | null;
  startsAt: Date;
  durationMinutes: number;
  therapists: { fullNameEn: string; fullNameAr: string }[];
  roomName: string | null;
  cancellationReason: string | null;
  cancellationCategory: CancellationCategory | null;
  cancellationNotes: string | null;
  cancelledByFullNameEn: string | null;
  cancelledByFullNameAr: string | null;
  cancelledAt: Date | null;
}

/**
 * Paginated list of cancelled appointments (Prompt 17). Filtered + sorted by
 * cancellation time (newest first). Phone is nulled for viewers who can't see
 * it (Doctor) — pass canSeePhone from the page based on the viewer's role.
 */
export async function listCancelledAppointments(args: {
  filters: CancelledAppointmentFilters;
  canSeePhone: boolean;
}): Promise<{ rows: CancelledAppointmentRow[]; total: number }> {
  const { filters, canSeePhone } = args;
  const where: Prisma.AppointmentWhereInput = {
    status: AppointmentStatus.CANCELLED,
    ...(filters.from || filters.to
      ? {
          cancelledAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.therapistId ? { therapists: { some: { therapistId: filters.therapistId } } } : {}),
    ...(filters.search
      ? {
          patient: {
            OR: [
              { fullNameEn: { contains: filters.search, mode: 'insensitive' } },
              { fullNameAr: { contains: filters.search } },
            ],
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.appointment.findMany({
      where,
      orderBy: { cancelledAt: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        patient: { select: { fullNameEn: true, fullNameAr: true, phone: true } },
        therapists: {
          orderBy: { createdAt: 'asc' },
          include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
        },
        room: { select: { name: true } },
        cancelledBy: { select: { fullNameEn: true, fullNameAr: true } },
      },
    }),
    db.appointment.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      patientFullNameEn: r.patient.fullNameEn,
      patientFullNameAr: r.patient.fullNameAr,
      patientPhone: canSeePhone ? r.patient.phone : null,
      startsAt: r.startsAt,
      durationMinutes: r.durationMinutes,
      therapists: r.therapists.map((t) => t.therapist),
      roomName: r.room?.name ?? null,
      cancellationReason: r.cancellationReason,
      cancellationCategory: r.cancellationCategory,
      cancellationNotes: r.cancellationNotes,
      cancelledByFullNameEn: r.cancelledBy?.fullNameEn ?? null,
      cancelledByFullNameAr: r.cancelledBy?.fullNameAr ?? null,
      cancelledAt: r.cancelledAt,
    })),
  };
}
