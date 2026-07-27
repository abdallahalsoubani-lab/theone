import { AuditAction } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 55 §4 — one-click patients roster export.
 *
 * The endpoint is the privacy boundary (P15): only `patients.export` holders
 * (Secretary + Admin) reach the file, so Doctor/Therapist can never see the
 * phone column. Sentinel DOB (P52) renders EMPTY (never 1900 / never an age),
 * a phone-less row renders empty (never "null"), and the export itself is
 * audited with the row count.
 */

const { audited } = vi.hoisted(() => ({
  audited: {
    configs: [] as Array<Record<string, unknown>>,
    calls: [] as Array<{ cfg: Record<string, unknown>; args: unknown[] }>,
  },
}));

vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (cfg: Record<string, unknown>, fn: (...a: unknown[]) => unknown) => {
    audited.configs.push(cfg);
    return async (...args: unknown[]) => {
      audited.calls.push({ cfg, args });
      return fn(...args);
    };
  },
}));

vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => null),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock('@/lib/db', () => {
  const state = {
    users: [] as Array<Record<string, unknown>>,
    completedDoctorPatientIds: [] as string[],
    userQueries: 0,
  };
  return {
    __state: state,
    db: {
      user: {
        findMany: vi.fn(async () => {
          state.userQueries += 1;
          return state.users;
        }),
      },
      appointment: {
        // pendingFirstVisitIds: returns the patients WITH a completed doctor visit.
        findMany: vi.fn(async () =>
          state.completedDoctorPatientIds.map((patientId) => ({ patientId })),
        ),
      },
    },
  };
});

import { getEffectiveSession } from '@/lib/impersonation/session';

import { GET } from '@/app/api/v1/exports/patients/route';
import { buildPatientsRosterCsv, listPatientsForExport } from '../export';

const sessionMock = vi.mocked(getEffectiveSession);

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    users: Array<Record<string, unknown>>;
    completedDoctorPatientIds: string[];
    userQueries: number;
  };
};

const labels = {
  header: {
    nameAr: 'الاسم (عربي)',
    nameEn: 'Name (English)',
    gender: 'Gender',
    dob: 'DOB',
    age: 'Age',
    phone: 'Phone',
    address: 'Address',
    occupation: 'Occupation',
    createdAt: 'Added on',
    firstVisit: 'Doctor visit',
  },
  gender: { MALE: 'ذكر', FEMALE: 'أنثى' } as const,
  firstVisitPending: 'بانتظار زيارة الدكتورة',
  firstVisitDone: 'تمت',
};

const seedUsers = () => {
  __state.users.push(
    {
      id: 'u1',
      fullNameEn: 'Ahmad Odeh',
      fullNameAr: 'أحمد عودة',
      phone: '+962790000001',
      createdAt: new Date('2026-07-20T12:00:00Z'),
      patientProfile: {
        dateOfBirth: new Date('1990-05-10T00:00:00Z'),
        gender: 'MALE',
        address: 'عمّان, الدوار الخامس',
        occupation: 'معلم',
      },
    },
    {
      id: 'u2',
      fullNameEn: '',
      fullNameAr: 'هالة سمّور',
      phone: null,
      createdAt: new Date('2026-07-21T09:00:00Z'),
      patientProfile: {
        // P52 sentinel — unknown DOB.
        dateOfBirth: new Date('1900-01-01T00:00:00Z'),
        gender: 'FEMALE',
        address: null,
        occupation: null,
      },
    },
    // Profile-less row must be excluded, mirroring listPatients.
    {
      id: 'u3',
      fullNameEn: 'X',
      fullNameAr: 'س',
      phone: null,
      createdAt: new Date(),
      patientProfile: null,
    },
  );
  __state.completedDoctorPatientIds.push('u1');
};

beforeEach(() => {
  __state.users.length = 0;
  __state.completedDoctorPatientIds.length = 0;
  __state.userQueries = 0;
  audited.calls.length = 0;
  sessionMock.mockReset();
  sessionMock.mockResolvedValue(null);
});

describe('listPatientsForExport', () => {
  it('maps roster fields, drops profile-less rows, derives the first-visit flag in batch', async () => {
    seedUsers();
    const rows = await listPatientsForExport();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      fullNameAr: 'أحمد عودة',
      phone: '+962790000001',
      pendingFirstVisit: false,
    });
    expect(rows[1]).toMatchObject({
      fullNameAr: 'هالة سمّور',
      phone: null,
      pendingFirstVisit: true,
    });
  });
});

describe('buildPatientsRosterCsv', () => {
  it('renders all columns; sentinel DOB → empty date AND empty age; null phone → empty, never "null"', async () => {
    seedUsers();
    const csv = buildPatientsRosterCsv(await listPatientsForExport(), labels);
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'الاسم (عربي),Name (English),Gender,DOB,Age,Phone,Address,Occupation,Added on,Doctor visit',
    );
    // Row 1: known DOB (age computed), comma-bearing address gets quoted.
    expect(lines[1]).toContain('أحمد عودة,Ahmad Odeh,ذكر,1990-05-10,');
    expect(lines[1]).toContain('"عمّان, الدوار الخامس"');
    expect(lines[1]).toContain('+962790000001');
    expect(lines[1]).toContain('تمت');
    // Row 2: sentinel DOB → both date and age EMPTY; phone/address/occupation empty.
    expect(lines[2]).toBe('هالة سمّور,,أنثى,,,,,,2026-07-21,بانتظار زيارة الدكتورة');
    expect(csv).not.toContain('1900-01-01');
    expect(csv).not.toContain('null');
  });

  it('escapes quotes RFC-4180 style', () => {
    const csv = buildPatientsRosterCsv(
      [
        {
          fullNameAr: 'قال "أنا"',
          fullNameEn: 'Q',
          gender: 'MALE',
          dateOfBirth: new Date('2000-01-01T00:00:00Z'),
          phone: null,
          address: null,
          occupation: null,
          createdAt: new Date('2026-07-01T10:00:00Z'),
          pendingFirstVisit: true,
        },
      ],
      labels,
    );
    expect(csv).toContain('"قال ""أنا"""');
  });
});

describe('GET /api/v1/exports/patients — endpoint-level RBAC (P15 boundary)', () => {
  const req = new Request('http://localhost/api/v1/exports/patients?locale=ar');

  it('403 for THERAPIST, DOCTOR, PATIENT, and anonymous — and the roster query never runs', async () => {
    for (const role of ['THERAPIST', 'DOCTOR', 'PATIENT'] as const) {
      sessionMock.mockResolvedValue({
        user: { id: `${role.toLowerCase()}-1`, role },
      } as unknown as Awaited<ReturnType<typeof getEffectiveSession>>);
      const res = await GET(req);
      expect(res.status).toBe(403);
    }
    sessionMock.mockResolvedValue(null);
    expect((await GET(req)).status).toBe(403);
    expect(__state.userQueries).toBe(0);
  });

  it('200 for SECRETARY: BOM + localized headers + all patients + dated filename', async () => {
    seedUsers();
    sessionMock.mockResolvedValue({
      user: { id: 'sec-1', role: 'SECRETARY' },
    } as unknown as Awaited<ReturnType<typeof getEffectiveSession>>);
    const res = await GET(req);
    expect(res.status).toBe(200);
    // Response.text() strips a leading BOM per the Fetch spec — assert the
    // raw BYTES carry EF BB BF (what Excel actually sees on disk).
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder().decode(bytes);
    // getTranslations is mocked as key-echo — header carries the key names.
    expect(body).toContain('colNameAr');
    expect(body).toContain('أحمد عودة');
    expect(body).toContain('هالة سمّور');
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(
      /attachment; filename="patients-\d{4}-\d{2}-\d{2}\.csv"/,
    );
  });

  it('ADMIN passes the same gate', async () => {
    seedUsers();
    sessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    } as unknown as Awaited<ReturnType<typeof getEffectiveSession>>);
    expect((await GET(req)).status).toBe(200);
  });

  it('audits the export as Patient READ_SENSITIVE with the row count', async () => {
    seedUsers();
    sessionMock.mockResolvedValue({
      user: { id: 'sec-1', role: 'SECRETARY' },
    } as unknown as Awaited<ReturnType<typeof getEffectiveSession>>);
    await GET(req);
    expect(audited.configs).toContainEqual(
      expect.objectContaining({ entityType: 'Patient', action: AuditAction.READ_SENSITIVE }),
    );
    const call = audited.calls.find((c) => c.cfg.entityType === 'Patient');
    expect(call?.args[0]).toEqual({ rowCount: 2 });
  });
});
