import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 14 — care-team (M2M) visibility suite. Supersedes the Prompt 13
 * single-assignment tests: the original regression (a patient invisible to
 * the clinician responsible for them) is still asserted, now through the
 * many-to-many model.
 */

// Hoist-safe in-memory fake of @/lib/db covering exactly the calls the
// care-team module + listPatients use.
vi.mock('@/lib/db', () => {
  interface Clinician {
    id: string;
    role: 'THERAPIST' | 'DOCTOR' | 'SECRETARY';
    fullNameEn: string;
    fullNameAr: string;
    deletedAt: Date | null;
  }
  interface Patient {
    id: string;
    fullNameEn: string;
    fullNameAr: string;
    phone: string;
    email: string | null;
    languagePref: 'EN' | 'AR';
    deletedAt: Date | null;
    profile: { dateOfBirth: Date; gender: 'MALE' | 'FEMALE' };
  }
  interface Member {
    id: string;
    patientId: string;
    clinicianId: string;
    role: 'THERAPIST' | 'DOCTOR';
    assignedBy: string;
  }
  const state = {
    clinicians: [] as Clinician[],
    patients: [] as Patient[],
    members: [] as Member[],
    auditLogs: [] as Array<Record<string, unknown>>,
    counter: 0,
  };

  const ref = (id: string) => {
    const c = state.clinicians.find((x) => x.id === id);
    return c ? { id: c.id, fullNameEn: c.fullNameEn, fullNameAr: c.fullNameAr } : null;
  };
  const membersOf = (patientId: string) => state.members.filter((m) => m.patientId === patientId);

  const matchesScope = (p: Patient, where: Record<string, unknown>): boolean => {
    const pp = where.patientProfile as
      | { careTeam?: { some?: { clinicianId?: string }; none?: Record<string, unknown> } }
      | undefined;
    if (!pp?.careTeam) return true;
    const mine = membersOf(p.id);
    if (pp.careTeam.none) return mine.length === 0;
    if (pp.careTeam.some) {
      const cond = pp.careTeam.some;
      return mine.some((m) => (cond.clinicianId ? m.clinicianId === cond.clinicianId : true));
    }
    return true;
  };

  const filterPatients = (where: Record<string, unknown>) =>
    state.patients.filter((p) => {
      if (where.deletedAt === null && p.deletedAt !== null) return false;
      return matchesScope(p, where);
    });

  const includePatient = (p: Patient) => ({
    id: p.id,
    fullNameEn: p.fullNameEn,
    fullNameAr: p.fullNameAr,
    phone: p.phone,
    email: p.email,
    languagePref: p.languagePref,
    deletedAt: p.deletedAt,
    patientProfile: {
      ...p.profile,
      careTeam: membersOf(p.id).map((m) => ({ role: m.role, clinician: ref(m.clinicianId) })),
    },
    intakesAsPatient: [] as Array<{ id: string; status: string }>,
  });

  return {
    __state: state,
    db: {
      user: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          filterPatients(where).map(includePatient),
        ),
        count: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) => filterPatients(where).length,
        ),
        findFirst: vi.fn(
          async ({ where }: { where: { id: string; deletedAt?: null; role?: string } }) => {
            const c = state.clinicians.find((x) => x.id === where.id && x.deletedAt === null);
            return c ? { role: c.role } : null;
          },
        ),
      },
      careTeamMember: {
        findMany: vi.fn(async ({ where }: { where: { patientId: string } }) =>
          membersOf(where.patientId).map((m) => ({ role: m.role, clinician: ref(m.clinicianId) })),
        ),
        findUnique: vi.fn(
          async ({
            where,
          }: {
            where: { patientId_clinicianId: { patientId: string; clinicianId: string } };
          }) => {
            const { patientId, clinicianId } = where.patientId_clinicianId;
            const m = state.members.find(
              (x) => x.patientId === patientId && x.clinicianId === clinicianId,
            );
            return m ? { id: m.id } : null;
          },
        ),
        create: vi.fn(async ({ data }: { data: Omit<Member, 'id'> }) => {
          state.counter += 1;
          const row: Member = { id: `m-${state.counter}`, ...data };
          state.members.push(row);
          return row;
        }),
        deleteMany: vi.fn(
          async ({ where }: { where: { patientId: string; clinicianId: string } }) => {
            const before = state.members.length;
            state.members = state.members.filter(
              (m) => !(m.patientId === where.patientId && m.clinicianId === where.clinicianId),
            );
            return { count: before - state.members.length };
          },
        ),
        upsert: vi.fn(
          async ({
            where,
            create,
          }: {
            where: { patientId_clinicianId: { patientId: string; clinicianId: string } };
            create: Omit<Member, 'id'>;
          }) => {
            const { patientId, clinicianId } = where.patientId_clinicianId;
            const existing = state.members.find(
              (m) => m.patientId === patientId && m.clinicianId === clinicianId,
            );
            if (existing) return existing;
            state.counter += 1;
            const row: Member = { id: `m-${state.counter}`, ...create };
            state.members.push(row);
            return row;
          },
        ),
        count: vi.fn(
          async ({ where }: { where: { clinicianId: string; role?: string } }) =>
            state.members.filter(
              (m) => m.clinicianId === where.clinicianId && (!where.role || m.role === where.role),
            ).length,
        ),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.auditLogs.push(data);
          return data;
        }),
      },
    },
  };
});

vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => ({ isImpersonating: false, user: { id: 'actor-1' } })),
}));

import {
  addCareTeamMember,
  addCareTeamMemberTx,
  getCareTeam,
  PatientAssignmentError,
  removeCareTeamMember,
  resolveClinicianRole,
} from '../assignment';
import { isClinicianAssignedTo, listPatients, type PatientScope } from '../queries';
import { type PatientListFilters } from '../schemas';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    clinicians: Array<{
      id: string;
      role: 'THERAPIST' | 'DOCTOR' | 'SECRETARY';
      fullNameEn: string;
      fullNameAr: string;
      deletedAt: Date | null;
    }>;
    patients: Array<{
      id: string;
      fullNameEn: string;
      fullNameAr: string;
      phone: string;
      email: string | null;
      languagePref: 'EN' | 'AR';
      deletedAt: Date | null;
      profile: { dateOfBirth: Date; gender: 'MALE' | 'FEMALE' };
    }>;
    members: Array<{
      id: string;
      patientId: string;
      clinicianId: string;
      role: 'THERAPIST' | 'DOCTOR';
      assignedBy: string;
    }>;
    auditLogs: Array<Record<string, unknown>>;
    counter: number;
  };
};

const db = await import('@/lib/db').then((m) => m.db);

const DEFAULT_FILTERS: PatientListFilters = {
  intakeStatus: 'all',
  assignment: 'all',
  ageGroup: 'all',
  page: 1,
  pageSize: 20,
};

function seedClinician(id: string, role: 'THERAPIST' | 'DOCTOR' | 'SECRETARY') {
  __state.clinicians.push({ id, role, fullNameEn: id, fullNameAr: id, deletedAt: null });
}
function seedPatient(id: string) {
  __state.patients.push({
    id,
    fullNameEn: id,
    fullNameAr: id,
    phone: '+962790000000',
    email: null,
    languagePref: 'EN',
    deletedAt: null,
    profile: { dateOfBirth: new Date('1990-01-01'), gender: 'MALE' },
  });
}
const assignedScope = (clinicianId: string): PatientScope => ({ kind: 'assigned', clinicianId });
const listFor = (clinicianId: string) =>
  listPatients({ scope: assignedScope(clinicianId), filters: DEFAULT_FILTERS });

beforeEach(() => {
  __state.clinicians.length = 0;
  __state.patients.length = 0;
  __state.members.length = 0;
  __state.auditLogs.length = 0;
  __state.counter = 0;
  seedClinician('therapist-1', 'THERAPIST');
  seedClinician('therapist-2', 'THERAPIST');
  seedClinician('doctor-1', 'DOCTOR');
  seedClinician('doctor-2', 'DOCTOR');
  seedClinician('secretary-1', 'SECRETARY');
});

describe('multiple clinicians per patient', () => {
  it('every member (2 therapists + 1 doctor) sees the patient; an unrelated therapist does not', async () => {
    seedPatient('p1');
    await addCareTeamMemberTx(db, 'p1', 'therapist-1', 'actor-1');
    await addCareTeamMemberTx(db, 'p1', 'therapist-2', 'actor-1');
    await addCareTeamMemberTx(db, 'p1', 'doctor-1', 'actor-1');

    for (const clinician of ['therapist-1', 'therapist-2', 'doctor-1']) {
      expect((await listFor(clinician)).rows.map((r) => r.id)).toEqual(['p1']);
    }
    expect((await listFor('doctor-2')).rows).toHaveLength(0);
  });

  it('getCareTeam splits members by role', async () => {
    seedPatient('p1');
    await addCareTeamMemberTx(db, 'p1', 'therapist-1', 'actor-1');
    await addCareTeamMemberTx(db, 'p1', 'therapist-2', 'actor-1');
    await addCareTeamMemberTx(db, 'p1', 'doctor-1', 'actor-1');
    const team = await getCareTeam('p1');
    expect(team.therapists.map((c) => c.id)).toEqual(['therapist-1', 'therapist-2']);
    expect(team.doctors.map((c) => c.id)).toEqual(['doctor-1']);
  });
});

describe('addCareTeamMember (audited)', () => {
  it('adds a member and writes an audit row', async () => {
    seedPatient('p1');
    await addCareTeamMember('p1', 'therapist-1', 'actor-1');
    expect((await listFor('therapist-1')).rows.map((r) => r.id)).toEqual(['p1']);
    expect(
      __state.auditLogs.some((a) => a.entityType === 'CareTeamMember' && a.action === 'CREATE'),
    ).toBe(true);
  });

  it('rejects a duplicate add with a localized error', async () => {
    seedPatient('p1');
    await addCareTeamMember('p1', 'therapist-1', 'actor-1');
    await expect(addCareTeamMember('p1', 'therapist-1', 'actor-1')).rejects.toBeInstanceOf(
      PatientAssignmentError,
    );
  });

  it('rejects a SECRETARY (role validation)', async () => {
    seedPatient('p1');
    await expect(addCareTeamMember('p1', 'secretary-1', 'actor-1')).rejects.toBeInstanceOf(
      PatientAssignmentError,
    );
    await expect(resolveClinicianRole('secretary-1', db)).rejects.toBeInstanceOf(
      PatientAssignmentError,
    );
  });
});

describe('removeCareTeamMember', () => {
  it('removes the patient from that clinician’s list only', async () => {
    seedPatient('p1');
    await addCareTeamMemberTx(db, 'p1', 'therapist-1', 'actor-1');
    await addCareTeamMemberTx(db, 'p1', 'therapist-2', 'actor-1');

    await removeCareTeamMember('p1', 'therapist-1', 'actor-1');

    expect((await listFor('therapist-1')).rows).toHaveLength(0);
    expect((await listFor('therapist-2')).rows.map((r) => r.id)).toEqual(['p1']);
    expect(
      __state.auditLogs.some((a) => a.entityType === 'CareTeamMember' && a.action === 'DELETE'),
    ).toBe(true);
  });
});

describe('plan back-fill semantics (addCareTeamMemberTx)', () => {
  it('is idempotent — re-adding the same doctor does not duplicate', async () => {
    seedPatient('p1');
    await addCareTeamMemberTx(db, 'p1', 'doctor-1', 'doctor-1');
    await addCareTeamMemberTx(db, 'p1', 'doctor-1', 'doctor-1');
    expect((await getCareTeam('p1')).doctors.map((c) => c.id)).toEqual(['doctor-1']);
  });

  it('a second plan by another doctor adds, not replaces', async () => {
    seedPatient('p1');
    await addCareTeamMemberTx(db, 'p1', 'doctor-1', 'doctor-1');
    await addCareTeamMemberTx(db, 'p1', 'doctor-2', 'doctor-2');
    expect((await getCareTeam('p1')).doctors.map((c) => c.id)).toEqual(['doctor-1', 'doctor-2']);
  });
});

describe('original bug regression (now via M2M)', () => {
  it('a patient with no care team is invisible to every clinician', async () => {
    seedPatient('ghost');
    for (const clinician of ['therapist-1', 'therapist-2', 'doctor-1', 'doctor-2']) {
      expect((await listFor(clinician)).rows).toHaveLength(0);
    }
    expect(await isClinicianAssignedTo('therapist-1', 'ghost')).toBe(false);
  });

  it('isClinicianAssignedTo matches care-team members only', async () => {
    seedPatient('p1');
    await addCareTeamMemberTx(db, 'p1', 'therapist-1', 'actor-1');
    await addCareTeamMemberTx(db, 'p1', 'doctor-1', 'actor-1');
    expect(await isClinicianAssignedTo('therapist-1', 'p1')).toBe(true);
    expect(await isClinicianAssignedTo('doctor-1', 'p1')).toBe(true);
    expect(await isClinicianAssignedTo('therapist-2', 'p1')).toBe(false);
    expect(await isClinicianAssignedTo('doctor-2', 'p1')).toBe(false);
  });
});
