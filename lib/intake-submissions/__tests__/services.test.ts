import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 23 §4/§6 — approval creates (or links) a patient and attaches the
 * intake; rejection creates nothing; the PENDING→APPROVED claim is atomic so a
 * concurrent double-approve produces exactly one patient.
 */

const m = vi.hoisted(() => ({
  submission: null as Record<string, unknown> | null,
  claimCount: 1,
  linkTarget: null as { id: string; phone: string } | null,
  updateManyCalls: [] as Array<{ where: unknown; data: Record<string, unknown> }>,
  updateCalls: [] as Array<{ where: unknown; data: Record<string, unknown> }>,
}));

vi.mock('@/lib/impersonation/session', () => ({ getEffectiveSession: vi.fn(async () => null) }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'sec-1' } })) }));

const createPatient = vi.hoisted(() =>
  vi.fn(async () => ({ patientId: 'pat-new', tempPassword: 'x', whatsappStatus: 'SENT' })),
);
vi.mock('@/lib/patients/services', () => ({ createPatient }));

const createAdultIntake = vi.hoisted(() => vi.fn(async () => ({ intakeId: 'int-1' })));
const createPediatricIntake = vi.hoisted(() => vi.fn(async () => ({ intakeId: 'int-2' })));
vi.mock('@/lib/intake/services', () => ({ createAdultIntake, createPediatricIntake }));

vi.mock('@/lib/db', () => ({
  db: {
    intakeSubmission: {
      findUnique: vi.fn(async () => m.submission),
      updateMany: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        m.updateManyCalls.push(args);
        return { count: m.claimCount };
      }),
      update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        m.updateCalls.push(args);
        return {};
      }),
    },
    user: { findFirst: vi.fn(async () => m.linkTarget) },
    auditLog: { create: vi.fn(async () => ({})) },
  },
  toLocalizedError: (e: unknown) => ({ code: 'ERR', message_en: String(e), message_ar: String(e) }),
}));

import { auth } from '@/auth';

import { approveSubmissionLink, approveSubmissionNew, rejectSubmission } from '../services';

const adultAnswers = {
  physicalActivityLevel: 'MODERATE',
  medicalDiagnosis: 'lower back pain',
  primaryComplaint: 'pain when bending',
  painTiming: 'DAY',
  symptomDuration: 'WEEKS_2_3',
  painSeverity: 'FIVE',
  painStability: 'CONSTANT',
  conditions: ['NONE'],
  referralSource: 'FRIEND_FAMILY',
  customAnswers: {},
};

const profile = {
  fullNameAr: 'يوسف النجار',
  fullNameEn: 'John Doe',
  phone: '+962790000000',
  dateOfBirth: '1990-01-01',
  gender: 'MALE',
  address: '123 Main Street',
  email: null,
  languagePref: 'EN',
};

function pendingAdult(extra: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    type: 'ADULT',
    status: 'PENDING',
    profile,
    answers: adultAnswers,
    submittedPhone: '+962790000000',
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.submission = pendingAdult();
  m.claimCount = 1;
  m.linkTarget = null;
  m.updateManyCalls.length = 0;
  m.updateCalls.length = 0;
});

describe('approveSubmissionNew', () => {
  it('creates a patient, attaches the intake, and stamps linkedPatientId', async () => {
    const res = await approveSubmissionNew({ submissionId: 'sub-1' });
    expect(res).toEqual({ submissionId: 'sub-1', patientId: 'pat-new', mode: 'NEW' });
    expect(createPatient).toHaveBeenCalledTimes(1);
    expect(createAdultIntake).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'pat-new' }),
    );
    // claim PENDING→APPROVED, then linkedPatientId set.
    expect(m.updateManyCalls[0]?.data.status).toBe('APPROVED');
    expect(m.updateCalls.at(-1)?.data).toEqual({ linkedPatientId: 'pat-new' });
  });

  it('maps each submitted name to its own column and carries the explicit languagePref (QA 5.2/5.3)', async () => {
    await approveSubmissionNew({ submissionId: 'sub-1' });
    expect(createPatient).toHaveBeenCalledWith(
      expect.objectContaining({
        fullNameAr: 'يوسف النجار',
        fullNameEn: 'John Doe',
        languagePref: 'EN',
      }),
      'sec-1',
    );
  });

  it('falls back to the AR name for fullNameEn when the EN name is missing — never empty', async () => {
    m.submission = pendingAdult({ profile: { ...profile, fullNameEn: null } });
    await approveSubmissionNew({ submissionId: 'sub-1' });
    expect(createPatient).toHaveBeenCalledWith(
      expect.objectContaining({ fullNameAr: 'يوسف النجار', fullNameEn: 'يوسف النجار' }),
      'sec-1',
    );
  });

  it('still approves a legacy pre-split submission (single fullName feeds both columns)', async () => {
    const { fullNameAr: _ar, fullNameEn: _en, ...rest } = profile;
    m.submission = pendingAdult({
      profile: { ...rest, fullName: 'John Doe', languagePref: 'AR' },
    });
    await approveSubmissionNew({ submissionId: 'sub-1' });
    expect(createPatient).toHaveBeenCalledWith(
      expect.objectContaining({
        fullNameAr: 'John Doe',
        fullNameEn: 'John Doe',
        languagePref: 'AR',
      }),
      'sec-1',
    );
  });

  it('denies an unauthenticated caller before any claim or write (RBAC/session guard)', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    await expect(approveSubmissionNew({ submissionId: 'sub-1' })).rejects.toThrow();
    expect(createPatient).not.toHaveBeenCalled();
    expect(m.updateManyCalls).toHaveLength(0);
  });

  it('is race-safe: a lost claim (count 0) creates no patient', async () => {
    m.claimCount = 0;
    await expect(approveSubmissionNew({ submissionId: 'sub-1' })).rejects.toThrow();
    expect(createPatient).not.toHaveBeenCalled();
  });

  it('rejects when the submission is already handled', async () => {
    m.submission = pendingAdult({ status: 'APPROVED' });
    await expect(approveSubmissionNew({ submissionId: 'sub-1' })).rejects.toThrow();
    expect(createPatient).not.toHaveBeenCalled();
  });

  it('releases the claim back to PENDING if patient creation fails', async () => {
    createPatient.mockRejectedValueOnce(new Error('duplicate phone'));
    await expect(approveSubmissionNew({ submissionId: 'sub-1' })).rejects.toThrow();
    const release = m.updateManyCalls.at(-1);
    expect(release?.data.status).toBe('PENDING');
  });
});

describe('approveSubmissionLink', () => {
  it('attaches the intake to the existing patient — no new patient created', async () => {
    m.linkTarget = { id: 'pat-existing', phone: '+962790000000' };
    const res = await approveSubmissionLink({ submissionId: 'sub-1', patientId: 'pat-existing' });
    expect(res).toEqual({ submissionId: 'sub-1', patientId: 'pat-existing', mode: 'LINK' });
    expect(createPatient).not.toHaveBeenCalled();
    expect(createAdultIntake).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'pat-existing' }),
    );
    expect(m.updateCalls.at(-1)?.data).toEqual({ linkedPatientId: 'pat-existing' });
  });

  it('refuses to link to a patient whose phone does not match', async () => {
    m.linkTarget = { id: 'pat-other', phone: '+962799999999' };
    await expect(
      approveSubmissionLink({ submissionId: 'sub-1', patientId: 'pat-other' }),
    ).rejects.toThrow();
    expect(createAdultIntake).not.toHaveBeenCalled();
  });
});

describe('rejectSubmission', () => {
  it('marks REJECTED and creates no patient', async () => {
    const res = await rejectSubmission({ submissionId: 'sub-1', reason: 'spam' });
    expect(res).toEqual({ submissionId: 'sub-1' });
    expect(createPatient).not.toHaveBeenCalled();
    expect(m.updateManyCalls[0]?.data.status).toBe('REJECTED');
    expect(m.updateManyCalls[0]?.data.rejectionReason).toBe('spam');
  });

  it('is race-safe: a lost claim throws', async () => {
    m.claimCount = 0;
    await expect(rejectSubmission({ submissionId: 'sub-1' })).rejects.toThrow();
  });
});
