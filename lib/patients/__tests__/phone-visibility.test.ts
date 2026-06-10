import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 15 §1 — patient phone numbers are hidden from THERAPIST/DOCTOR at the
 * data layer (serialized shape), visible to SECRETARY/ADMIN and the patient
 * themself. Asserts the query output, not the UI.
 */

// Mutable session for @/auth so each test picks the viewer.
const sessionRef: { current: { user: { id: string; role: string } } | null } = { current: null };
vi.mock('@/auth', () => ({ auth: vi.fn(async () => sessionRef.current) }));

vi.mock('@/lib/db', () => {
  interface Patient {
    id: string;
    fullNameEn: string;
    fullNameAr: string;
    phone: string;
    email: string | null;
    languagePref: 'EN' | 'AR';
    deletedAt: Date | null;
    profile: { dateOfBirth: Date; gender: 'MALE' | 'FEMALE'; emergencyContactPhone: string | null };
    careTeamClinicianIds: string[];
  }
  const state = { patients: [] as Patient[] };

  const contains = (hay: string | null, needle: unknown) =>
    typeof needle === 'object' && needle !== null && 'contains' in needle
      ? (hay ?? '').includes((needle as { contains: string }).contains)
      : false;

  const matchesOr = (p: Patient, or: Array<Record<string, unknown>> | undefined) => {
    if (!or) return true;
    return or.some((clause) => {
      if ('fullNameEn' in clause) return contains(p.fullNameEn, clause.fullNameEn);
      if ('fullNameAr' in clause) return contains(p.fullNameAr, clause.fullNameAr);
      if ('phone' in clause) return contains(p.phone, clause.phone);
      if ('email' in clause) return contains(p.email, clause.email);
      return false;
    });
  };

  const scopeOk = (p: Patient, where: Record<string, unknown>) => {
    const pp = where.patientProfile as
      | { careTeam?: { some?: { clinicianId?: string } } }
      | undefined;
    const cid = pp?.careTeam?.some?.clinicianId;
    if (!cid) return true;
    return p.careTeamClinicianIds.includes(cid);
  };

  const filter = (where: Record<string, unknown>) =>
    state.patients.filter(
      (p) =>
        (where.deletedAt !== null || p.deletedAt === null) &&
        scopeOk(p, where) &&
        matchesOr(p, where.OR as Array<Record<string, unknown>> | undefined),
    );

  return {
    __state: state,
    db: {
      user: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          filter(where).map((p) => ({
            id: p.id,
            fullNameEn: p.fullNameEn,
            fullNameAr: p.fullNameAr,
            phone: p.phone,
            email: p.email,
            languagePref: p.languagePref,
            deletedAt: p.deletedAt,
            patientProfile: {
              dateOfBirth: p.profile.dateOfBirth,
              gender: p.profile.gender,
              careTeam: [],
            },
            intakesAsPatient: [],
          })),
        ),
        count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filter(where).length),
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          const p = state.patients.find((x) => x.id === where.id);
          if (!p) return null;
          return {
            id: p.id,
            fullNameEn: p.fullNameEn,
            fullNameAr: p.fullNameAr,
            phone: p.phone,
            email: p.email,
            languagePref: p.languagePref,
            deletedAt: p.deletedAt,
            mustChangePassword: false,
            whatsappReachable: true,
            whatsappLastFailureAt: null,
            whatsappLastFailureReason: null,
            patientProfile: {
              dateOfBirth: p.profile.dateOfBirth,
              gender: p.profile.gender,
              nationalId: null,
              address: null,
              occupation: null,
              emergencyContactName: null,
              emergencyContactPhone: p.profile.emergencyContactPhone,
              hijriCalendarPref: false,
              medicalHistorySummary: null,
              allergies: null,
              currentMedications: null,
              careTeam: [],
            },
          };
        }),
      },
      whatsAppMessage: { findFirst: vi.fn(async () => null) },
    },
  };
});

import { auth } from '@/auth';
import { viewerCanSeePatientPhone } from '../access';
import { getPatientFile, listPatients } from '../queries';
import { type PatientListFilters } from '../schemas';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    patients: Array<{
      id: string;
      fullNameEn: string;
      fullNameAr: string;
      phone: string;
      email: string | null;
      languagePref: 'EN' | 'AR';
      deletedAt: Date | null;
      profile: {
        dateOfBirth: Date;
        gender: 'MALE' | 'FEMALE';
        emergencyContactPhone: string | null;
      };
      careTeamClinicianIds: string[];
    }>;
  };
};

const FILTERS: PatientListFilters = {
  intakeStatus: 'all',
  assignment: 'all',
  ageGroup: 'all',
  page: 1,
  pageSize: 20,
};

function seedPatient(id: string, phone: string, clinicianIds: string[] = []) {
  __state.patients.push({
    id,
    fullNameEn: id,
    fullNameAr: id,
    phone,
    email: null,
    languagePref: 'EN',
    deletedAt: null,
    profile: {
      dateOfBirth: new Date('1990-01-01'),
      gender: 'MALE',
      emergencyContactPhone: '+962790009999',
    },
    careTeamClinicianIds: clinicianIds,
  });
}

beforeEach(() => {
  __state.patients.length = 0;
  sessionRef.current = null;
  vi.mocked(auth).mockClear();
});

describe('viewerCanSeePatientPhone', () => {
  it('allows SECRETARY and ADMIN', async () => {
    sessionRef.current = { user: { id: 's', role: 'SECRETARY' } };
    expect(await viewerCanSeePatientPhone('p1')).toBe(true);
    sessionRef.current = { user: { id: 'a', role: 'ADMIN' } };
    expect(await viewerCanSeePatientPhone('p1')).toBe(true);
  });

  it('denies THERAPIST and DOCTOR', async () => {
    sessionRef.current = { user: { id: 't', role: 'THERAPIST' } };
    expect(await viewerCanSeePatientPhone('p1')).toBe(false);
    sessionRef.current = { user: { id: 'd', role: 'DOCTOR' } };
    expect(await viewerCanSeePatientPhone('p1')).toBe(false);
  });

  it('allows a PATIENT to see only their own phone', async () => {
    sessionRef.current = { user: { id: 'p1', role: 'PATIENT' } };
    expect(await viewerCanSeePatientPhone('p1')).toBe(true);
    expect(await viewerCanSeePatientPhone('p2')).toBe(false);
  });

  it('fails closed with no session', async () => {
    sessionRef.current = null;
    expect(await viewerCanSeePatientPhone('p1')).toBe(false);
  });
});

describe('listPatients phone visibility (by scope)', () => {
  it('Secretary/Admin scope "all" returns the phone', async () => {
    seedPatient('p1', '+962791112222');
    const { rows } = await listPatients({ scope: { kind: 'all' }, filters: FILTERS });
    expect(rows[0]!.phone).toBe('+962791112222');
  });

  it('Doctor/Therapist scope "assigned" nulls the phone', async () => {
    seedPatient('p1', '+962791112222', ['therapist-1']);
    const { rows } = await listPatients({
      scope: { kind: 'assigned', clinicianId: 'therapist-1' },
      filters: FILTERS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phone).toBeNull();
  });
});

describe('search by phone digits', () => {
  it('Secretary search by phone digits finds the patient', async () => {
    seedPatient('p1', '+962791112222');
    const { rows } = await listPatients({
      scope: { kind: 'all' },
      filters: { ...FILTERS, search: '1112222' },
    });
    expect(rows.map((r) => r.id)).toEqual(['p1']);
  });

  it('Therapist search by phone digits returns nothing (phone not searchable)', async () => {
    seedPatient('p1', '+962791112222', ['therapist-1']);
    const { rows } = await listPatients({
      scope: { kind: 'assigned', clinicianId: 'therapist-1' },
      filters: { ...FILTERS, search: '1112222' },
    });
    expect(rows).toHaveLength(0);
  });
});

describe('getPatientFile phone visibility (session-aware)', () => {
  beforeEach(() => seedPatient('p1', '+962793334444'));

  it('Secretary sees phone + emergency phone', async () => {
    sessionRef.current = { user: { id: 's', role: 'SECRETARY' } };
    const file = await getPatientFile('p1');
    expect(file?.phone).toBe('+962793334444');
    expect(file?.emergencyContactPhone).toBe('+962790009999');
  });

  it('Therapist gets null phone + null emergency phone', async () => {
    sessionRef.current = { user: { id: 't', role: 'THERAPIST' } };
    const file = await getPatientFile('p1');
    expect(file?.phone).toBeNull();
    expect(file?.emergencyContactPhone).toBeNull();
  });

  it('Doctor gets null phone', async () => {
    sessionRef.current = { user: { id: 'd', role: 'DOCTOR' } };
    const file = await getPatientFile('p1');
    expect(file?.phone).toBeNull();
  });

  it('the patient themself still sees their own phone', async () => {
    sessionRef.current = { user: { id: 'p1', role: 'PATIENT' } };
    const file = await getPatientFile('p1');
    expect(file?.phone).toBe('+962793334444');
  });
});
