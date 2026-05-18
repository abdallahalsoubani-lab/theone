import { UserRole, type Gender, type LanguagePref, type Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import { computeAgeYears, isPediatric, type PatientListFilters } from './schemas';

export interface PatientListRow {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  phone: string;
  email: string | null;
  dateOfBirth: Date;
  ageYears: number;
  gender: Gender;
  languagePref: LanguagePref;
  archived: boolean;
  assignedTherapist: { id: string; fullNameEn: string; fullNameAr: string } | null;
  responsibleDoctor: { id: string; fullNameEn: string; fullNameAr: string } | null;
  intakeCount: number;
  hasCompletedIntake: boolean;
}

export type PatientScope =
  | { kind: 'all' } // Secretary, Admin
  | { kind: 'assigned'; clinicianId: string }; // Doctor, Therapist

interface ListOptions {
  scope: PatientScope;
  filters: PatientListFilters;
}

export async function listPatients({
  scope,
  filters,
}: ListOptions): Promise<{ rows: PatientListRow[]; total: number }> {
  const where: Prisma.UserWhereInput = {
    role: UserRole.PATIENT,
    deletedAt: null,
    ...(scope.kind === 'assigned'
      ? {
          patientProfile: {
            OR: [
              { assignedTherapistId: scope.clinicianId },
              { responsibleDoctorId: scope.clinicianId },
            ],
          },
        }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { fullNameEn: { contains: filters.search, mode: 'insensitive' } },
            { fullNameAr: { contains: filters.search } },
            { phone: { contains: filters.search } },
            { email: { contains: filters.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(filters.language ? { languagePref: filters.language } : {}),
    ...(filters.assignment === 'assigned'
      ? { patientProfile: { assignedTherapistId: { not: null } } }
      : {}),
    ...(filters.assignment === 'unassigned'
      ? { patientProfile: { assignedTherapistId: null } }
      : {}),
  };

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { fullNameEn: 'asc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        patientProfile: {
          include: {
            assignedTherapist: { select: { id: true, fullNameEn: true, fullNameAr: true } },
            responsibleDoctor: { select: { id: true, fullNameEn: true, fullNameAr: true } },
          },
        },
        intakesAsPatient: {
          select: { id: true, status: true },
        },
      },
    }),
    db.user.count({ where }),
  ]);

  let rows = users
    .filter((u) => u.patientProfile !== null)
    .map((u): PatientListRow => {
      const profile = u.patientProfile!;
      const ageYears = computeAgeYears(profile.dateOfBirth);
      const hasCompleted = u.intakesAsPatient.some((i) => i.status !== 'IN_PROGRESS');
      return {
        id: u.id,
        fullNameEn: u.fullNameEn,
        fullNameAr: u.fullNameAr,
        phone: u.phone,
        email: u.email,
        dateOfBirth: profile.dateOfBirth,
        ageYears,
        gender: profile.gender,
        languagePref: u.languagePref,
        archived: u.deletedAt !== null,
        assignedTherapist: profile.assignedTherapist,
        responsibleDoctor: profile.responsibleDoctor,
        intakeCount: u.intakesAsPatient.length,
        hasCompletedIntake: hasCompleted,
      };
    });

  // Age-bucket filter applied after the SQL join (computed field).
  if (filters.ageGroup === 'adult') {
    rows = rows.filter((r) => !isPediatric(r.dateOfBirth));
  } else if (filters.ageGroup === 'pediatric') {
    rows = rows.filter((r) => isPediatric(r.dateOfBirth));
  }

  // Intake-status filter, computed.
  if (filters.intakeStatus === 'pending') {
    rows = rows.filter((r) => r.intakeCount === 0 || !r.hasCompletedIntake);
  } else if (filters.intakeStatus === 'completed') {
    rows = rows.filter((r) => r.intakeCount > 0 && r.hasCompletedIntake);
  } else if (filters.intakeStatus === 'multiple') {
    rows = rows.filter((r) => r.intakeCount > 1);
  }

  return { rows, total };
}

export async function getPatientById(id: string) {
  return db.user.findFirst({
    where: { id, role: UserRole.PATIENT },
    include: {
      patientProfile: {
        include: {
          assignedTherapist: { select: { id: true, fullNameEn: true, fullNameAr: true } },
          responsibleDoctor: { select: { id: true, fullNameEn: true, fullNameAr: true } },
        },
      },
    },
  });
}

/** Flattened shape for the file UI — caller-friendly subset. */
export interface PatientFileData {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  phone: string;
  email: string | null;
  dateOfBirth: Date;
  gender: 'MALE' | 'FEMALE';
  nationalId: string | null;
  address: string | null;
  occupation: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  hijriCalendarPref: boolean;
  medicalHistorySummary: string | null;
  allergies: string | null;
  currentMedications: string | null;
  languagePref: 'EN' | 'AR';
  archived: boolean;
  mustChangePassword: boolean;
  assignedTherapist: { id: string; fullNameEn: string; fullNameAr: string } | null;
  responsibleDoctor: { id: string; fullNameEn: string; fullNameAr: string } | null;
  whatsappReachable: boolean;
  whatsappLastFailureAt: Date | null;
  whatsappLastFailureReason: string | null;
  whatsappLastDeliveryAt: Date | null;
}

export async function getPatientFile(id: string): Promise<PatientFileData | null> {
  const u = await getPatientById(id);
  if (!u || !u.patientProfile) return null;
  const p = u.patientProfile;
  // Look up the most recent successful outbound delivery so the profile
  // section can show "Last delivery on …". Cheap because the
  // (recipientPhone, sentAt DESC) index covers it.
  const lastDelivered = await db.whatsAppMessage.findFirst({
    where: {
      recipientId: u.id,
      direction: 'OUTBOUND',
      status: { in: ['DELIVERED', 'READ', 'SENT'] },
    },
    orderBy: { sentAt: 'desc' },
    select: { deliveredAt: true, sentAt: true },
  });
  return {
    id: u.id,
    fullNameEn: u.fullNameEn,
    fullNameAr: u.fullNameAr,
    phone: u.phone,
    email: u.email,
    dateOfBirth: p.dateOfBirth,
    gender: p.gender,
    nationalId: p.nationalId,
    address: p.address,
    occupation: p.occupation,
    emergencyContactName: p.emergencyContactName,
    emergencyContactPhone: p.emergencyContactPhone,
    hijriCalendarPref: p.hijriCalendarPref,
    medicalHistorySummary: p.medicalHistorySummary,
    allergies: p.allergies,
    currentMedications: p.currentMedications,
    languagePref: u.languagePref,
    archived: u.deletedAt !== null,
    mustChangePassword: u.mustChangePassword,
    assignedTherapist: p.assignedTherapist,
    responsibleDoctor: p.responsibleDoctor,
    whatsappReachable: u.whatsappReachable,
    whatsappLastFailureAt: u.whatsappLastFailureAt,
    whatsappLastFailureReason: u.whatsappLastFailureReason,
    whatsappLastDeliveryAt: lastDelivered?.deliveredAt ?? lastDelivered?.sentAt ?? null,
  };
}

/**
 * For Doctor / Therapist scope: returns true when the actor is assigned to
 * the patient (as primary therapist or responsible doctor) — used by the
 * patient-file gate and the can() resource check.
 */
export async function isClinicianAssignedTo(
  clinicianId: string,
  patientId: string,
): Promise<boolean> {
  const profile = await db.patientProfile.findUnique({
    where: { userId: patientId },
    select: { assignedTherapistId: true, responsibleDoctorId: true },
  });
  if (!profile) return false;
  return profile.assignedTherapistId === clinicianId || profile.responsibleDoctorId === clinicianId;
}
