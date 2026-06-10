import {
  CareTeamRole,
  UserRole,
  type Gender,
  type LanguagePref,
  type Prisma,
} from '@prisma/client';

import { db } from '@/lib/db';

import { type CareTeam, type ClinicianRef } from './assignment';
import { computeAgeYears, isPediatric, type PatientListFilters } from './schemas';

// Re-export so the patient-file gate and can() resource check keep importing
// the assignment check from one place (`@/lib/patients/queries`) even though
// the implementation now lives in the care-team module.
export { isClinicianAssignedTo } from './assignment';

export interface PatientListRow {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  /** Null for Doctor/Therapist viewers — phone is hidden from them (Prompt 15 §1). */
  phone: string | null;
  email: string | null;
  dateOfBirth: Date;
  ageYears: number;
  gender: Gender;
  languagePref: LanguagePref;
  archived: boolean;
  therapists: ClinicianRef[];
  doctors: ClinicianRef[];
  intakeCount: number;
  hasCompletedIntake: boolean;
}

const careTeamInclude = {
  select: { role: true, clinician: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
} as const;

function splitCareTeam(members: Array<{ role: CareTeamRole; clinician: ClinicianRef }>): CareTeam {
  return {
    therapists: members.filter((m) => m.role === CareTeamRole.THERAPIST).map((m) => m.clinician),
    doctors: members.filter((m) => m.role === CareTeamRole.DOCTOR).map((m) => m.clinician),
  };
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
  // Only Secretary/Admin (scope 'all') may see — and therefore search by —
  // patient phone numbers (Prompt 15 §1). Doctor/Therapist (scope 'assigned')
  // get the phone nulled out and the phone search term disabled.
  const canSeePhone = scope.kind === 'all';
  const where: Prisma.UserWhereInput = {
    role: UserRole.PATIENT,
    deletedAt: null,
    ...(scope.kind === 'assigned'
      ? {
          patientProfile: {
            careTeam: { some: { clinicianId: scope.clinicianId } },
          },
        }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { fullNameEn: { contains: filters.search, mode: 'insensitive' } },
            { fullNameAr: { contains: filters.search } },
            ...(canSeePhone ? [{ phone: { contains: filters.search } }] : []),
            { email: { contains: filters.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(filters.language ? { languagePref: filters.language } : {}),
    ...(filters.assignment === 'assigned' ? { patientProfile: { careTeam: { some: {} } } } : {}),
    ...(filters.assignment === 'unassigned' ? { patientProfile: { careTeam: { none: {} } } } : {}),
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
            careTeam: careTeamInclude,
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
      const careTeam = splitCareTeam(profile.careTeam);
      return {
        id: u.id,
        fullNameEn: u.fullNameEn,
        fullNameAr: u.fullNameAr,
        phone: canSeePhone ? u.phone : null,
        email: u.email,
        dateOfBirth: profile.dateOfBirth,
        ageYears,
        gender: profile.gender,
        languagePref: u.languagePref,
        archived: u.deletedAt !== null,
        therapists: careTeam.therapists,
        doctors: careTeam.doctors,
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
          careTeam: careTeamInclude,
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
  /** Null for Doctor/Therapist viewers — phone is hidden from them (Prompt 15 §1). */
  phone: string | null;
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
  careTeam: CareTeam;
  whatsappReachable: boolean;
  whatsappLastFailureAt: Date | null;
  whatsappLastFailureReason: string | null;
  whatsappLastDeliveryAt: Date | null;
}

export async function getPatientFile(id: string): Promise<PatientFileData | null> {
  const u = await getPatientById(id);
  if (!u || !u.patientProfile) return null;
  const p = u.patientProfile;
  // Phone numbers are hidden from Doctor/Therapist viewers at the data layer
  // (Prompt 15 §1) — Secretary/Admin and the patient themself still see them.
  // Lazy import keeps `@/auth` out of this module's load graph so query
  // consumers that never call getPatientFile stay test-isolatable.
  const { viewerCanSeePatientPhone } = await import('./access');
  const canSeePhone = await viewerCanSeePatientPhone(id);
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
    phone: canSeePhone ? u.phone : null,
    email: u.email,
    dateOfBirth: p.dateOfBirth,
    gender: p.gender,
    nationalId: p.nationalId,
    address: p.address,
    occupation: p.occupation,
    emergencyContactName: p.emergencyContactName,
    emergencyContactPhone: canSeePhone ? p.emergencyContactPhone : null,
    hijriCalendarPref: p.hijriCalendarPref,
    medicalHistorySummary: p.medicalHistorySummary,
    allergies: p.allergies,
    currentMedications: p.currentMedications,
    languagePref: u.languagePref,
    archived: u.deletedAt !== null,
    mustChangePassword: u.mustChangePassword,
    careTeam: splitCareTeam(p.careTeam),
    whatsappReachable: u.whatsappReachable,
    whatsappLastFailureAt: u.whatsappLastFailureAt,
    whatsappLastFailureReason: u.whatsappLastFailureReason,
    whatsappLastDeliveryAt: lastDelivered?.deliveredAt ?? lastDelivered?.sentAt ?? null,
  };
}
