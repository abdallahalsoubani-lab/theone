import { AuditAction, CareTeamRole, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db, type LocalizedError } from '@/lib/db';

/**
 * Single source of truth for *how a patient is linked to the clinicians
 * responsible for them* — the care team.
 *
 * A patient has any number of therapists and any number of doctors, stored as
 * `CareTeamMember` rows (Prompt 14, replacing the former single
 * `assignedTherapistId` / `responsibleDoctorId` scalars from Prompt 13).
 * Every assignment read/write funnels through this module so the rest of the
 * app stays storage-agnostic.
 *
 * Two layers:
 *   - Audited public mutations (`addCareTeamMember` / `removeCareTeamMember`)
 *     used by the Secretary/Admin care-team UI — one AuditLog row each.
 *   - `addCareTeamMemberTx`, an idempotent in-transaction insert (no audit of
 *     its own) used when the membership change is part of a larger audited
 *     operation: patient creation and the plan-create back-fill.
 */

/** Accepts the full PrismaClient or a `$transaction` client. */
type DbClient = Prisma.TransactionClient | typeof db;

export class PatientAssignmentError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'PatientAssignmentError';
  }
}

const invalidClinician: LocalizedError = {
  code: 'CARE_TEAM_INVALID_CLINICIAN',
  message_en: 'Only active therapists and doctors can join a care team.',
  message_ar: 'يمكن فقط للمعالجين والأطباء النشطين الانضمام إلى الفريق المعالج.',
};

const duplicateMember: LocalizedError = {
  code: 'CARE_TEAM_DUPLICATE_MEMBER',
  message_en: 'This clinician is already on the patient’s care team.',
  message_ar: 'هذا المختص موجود بالفعل في الفريق المعالج للمراجع.',
};

export interface ClinicianRef {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

export interface CareTeam {
  therapists: ClinicianRef[];
  doctors: ClinicianRef[];
}

const clinicianSelect = { id: true, fullNameEn: true, fullNameAr: true } as const;

/**
 * Resolve a clinician's care-team role from their User.role, validating they
 * are an active THERAPIST or DOCTOR. Throws `PatientAssignmentError` otherwise
 * (e.g. a Secretary, Patient, deleted user, or unknown id).
 */
export async function resolveClinicianRole(
  clinicianId: string,
  client: DbClient = db,
): Promise<CareTeamRole> {
  const user = await client.user.findFirst({
    where: { id: clinicianId, deletedAt: null },
    select: { role: true },
  });
  if (user?.role === UserRole.THERAPIST) return CareTeamRole.THERAPIST;
  if (user?.role === UserRole.DOCTOR) return CareTeamRole.DOCTOR;
  throw new PatientAssignmentError(invalidClinician);
}

/** Full care team for a patient, split by role and ordered by assignment time. */
export async function getCareTeam(patientId: string, client: DbClient = db): Promise<CareTeam> {
  const members = await client.careTeamMember.findMany({
    where: { patientId },
    select: { role: true, clinician: { select: clinicianSelect } },
    orderBy: { assignedAt: 'asc' },
  });
  return {
    therapists: members.filter((m) => m.role === CareTeamRole.THERAPIST).map((m) => m.clinician),
    doctors: members.filter((m) => m.role === CareTeamRole.DOCTOR).map((m) => m.clinician),
  };
}

/**
 * True when the clinician is a member of the patient's care team — the
 * Doctor/Therapist visibility check (patient-file gate + can() resource check).
 * Same signature as the pre-M2M helper so call sites are unchanged.
 */
export async function isClinicianAssignedTo(
  clinicianId: string,
  patientId: string,
  client: DbClient = db,
): Promise<boolean> {
  const member = await client.careTeamMember.findUnique({
    where: { patientId_clinicianId: { patientId, clinicianId } },
    select: { id: true },
  });
  return member !== null;
}

/**
 * Idempotent, non-audited membership insert for use INSIDE a larger
 * transaction (patient creation, plan-create back-fill). Validates the
 * clinician's role; if they are already on the team it is a no-op. Pass the
 * transaction client so the insert shares the caller's atomic boundary.
 */
export async function addCareTeamMemberTx(
  client: DbClient,
  patientId: string,
  clinicianId: string,
  byUserId: string,
): Promise<void> {
  const role = await resolveClinicianRole(clinicianId, client);
  await client.careTeamMember.upsert({
    where: { patientId_clinicianId: { patientId, clinicianId } },
    update: {},
    create: { patientId, clinicianId, role, assignedBy: byUserId },
  });
}

interface CareTeamMemberResult {
  id: string;
  patientId: string;
  clinicianId: string;
  role: CareTeamRole;
}

/**
 * Add a clinician to a patient's care team (audited). Validates the clinician
 * is an active therapist/doctor and rejects an existing membership with a
 * localized error. `byUserId` is recorded as `assignedBy`.
 */
export const addCareTeamMember = withAudit<[string, string, string], CareTeamMemberResult>(
  {
    entityType: 'CareTeamMember',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.id,
    extractAfter: (result) => ({
      patientId: result.patientId,
      clinicianId: result.clinicianId,
      role: result.role,
      event: 'CARE_TEAM_MEMBER_ADDED',
    }),
  },
  async function addCareTeamMemberInner(
    patientId,
    clinicianId,
    byUserId,
  ): Promise<CareTeamMemberResult> {
    const role = await resolveClinicianRole(clinicianId);
    const existing = await db.careTeamMember.findUnique({
      where: { patientId_clinicianId: { patientId, clinicianId } },
      select: { id: true },
    });
    if (existing) throw new PatientAssignmentError(duplicateMember);
    return db.careTeamMember.create({
      data: { patientId, clinicianId, role, assignedBy: byUserId },
      select: { id: true, patientId: true, clinicianId: true, role: true },
    });
  },
);

/**
 * Remove a clinician from a patient's care team (audited). Idempotent — a
 * no-op delete still audits the intent. `byUserId` is accepted for symmetry
 * with `addCareTeamMember`; the responsible actor is captured by withAudit.
 */
export const removeCareTeamMember = withAudit<
  [string, string, string],
  { patientId: string; clinicianId: string }
>(
  {
    entityType: 'CareTeamMember',
    action: AuditAction.DELETE,
    extractEntityId: (args) => `${args[0]}:${args[1]}`,
    extractBefore: (args) =>
      db.careTeamMember.findUnique({
        where: { patientId_clinicianId: { patientId: args[0], clinicianId: args[1] } },
      }),
    extractAfter: () => ({ event: 'CARE_TEAM_MEMBER_REMOVED' }),
  },
  async function removeCareTeamMemberInner(
    patientId,
    clinicianId,
    _byUserId,
  ): Promise<{ patientId: string; clinicianId: string }> {
    await db.careTeamMember.deleteMany({ where: { patientId, clinicianId } });
    return { patientId, clinicianId };
  },
);

export function isPatientAssignmentError(err: unknown): err is PatientAssignmentError {
  return err instanceof PatientAssignmentError;
}
