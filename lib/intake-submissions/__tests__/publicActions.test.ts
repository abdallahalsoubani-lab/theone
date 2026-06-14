import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 23 §3/§6 — the public submit endpoint is unauthenticated and
 * WRITE-only. It creates exactly one PENDING submission and never a patient;
 * it enforces name/phone, normalises the phone, and is hardened with an IP
 * rate-limit, a payload cap, and a honeypot.
 */

const h = vi.hoisted(() => ({
  rateLimitAllowed: { value: true },
  createCalls: [] as unknown[],
}));

vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => '203.0.113.5' }),
}));

// services.ts (transitively imported) pulls in Auth.js + the patient-create
// service; stub them so the module loads without next-auth in the test env.
// createPublicSubmission itself uses none of them.
vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('@/lib/impersonation/session', () => ({ getEffectiveSession: vi.fn(async () => null) }));
vi.mock('@/lib/patients/services', () => ({ createPatient: vi.fn() }));
vi.mock('@/lib/intake/services', () => ({
  createAdultIntake: vi.fn(),
  createPediatricIntake: vi.fn(),
}));

vi.mock('@/lib/auth/rate-limit', () => ({
  rateLimit: vi.fn(async () => ({
    allowed: h.rateLimitAllowed.value,
    count: 1,
    remainingTtlSeconds: 60,
  })),
}));

vi.mock('@/lib/db', () => ({
  db: {
    intakeSubmission: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        h.createCalls.push(data);
        return { id: 'sub-1' };
      }),
    },
  },
  toLocalizedError: (e: unknown) => ({ code: 'ERR', message_en: String(e), message_ar: String(e) }),
}));

import { submitPublicIntakeAction } from '../publicActions';

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

const validAdult = {
  type: 'ADULT' as const,
  locale: 'en' as const,
  website: '',
  profile: {
    fullName: 'John Doe',
    phone: '0790000000',
    dateOfBirth: '1990-01-01',
    gender: 'MALE',
    address: '123 Main Street',
    email: '',
  },
  answers: adultAnswers,
};

const validChild = {
  type: 'PEDIATRIC' as const,
  locale: 'ar' as const,
  website: '',
  profile: {
    fullName: 'Lina Child',
    phone: '0791111111',
    dateOfBirth: '2018-05-05',
    gender: 'FEMALE',
    address: '5 Clinic Road',
    email: '',
  },
  answers: { numberOfSiblings: 2, birthOrder: 1, customAnswers: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.rateLimitAllowed.value = true;
  h.createCalls.length = 0;
});

describe('submitPublicIntakeAction', () => {
  it('adult: creates one PENDING submission, normalises the phone, no patient', async () => {
    const res = await submitPublicIntakeAction(validAdult);
    expect(res.ok).toBe(true);
    expect(h.createCalls).toHaveLength(1);
    const data = h.createCalls[0] as { type: string; submittedPhone: string; status?: string };
    expect(data.type).toBe('ADULT');
    expect(data.submittedPhone).toBe('+962790000000'); // normalised E.164
    // status is left to the schema default (PENDING) — never set to anything else here.
    expect(data.status).toBeUndefined();
  });

  it('child: creates one PENDING submission', async () => {
    const res = await submitPublicIntakeAction(validChild);
    expect(res.ok).toBe(true);
    expect(h.createCalls).toHaveLength(1);
    expect((h.createCalls[0] as { type: string }).type).toBe('PEDIATRIC');
  });

  it('rejects a missing name', async () => {
    const res = await submitPublicIntakeAction({
      ...validAdult,
      profile: { ...validAdult.profile, fullName: '' },
    });
    expect(res.ok).toBe(false);
    expect(h.createCalls).toHaveLength(0);
  });

  it('rejects a non-Jordan phone', async () => {
    const res = await submitPublicIntakeAction({
      ...validAdult,
      profile: { ...validAdult.profile, phone: '1234567' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INTAKE_SUBMISSION_INVALID_PHONE');
    expect(h.createCalls).toHaveLength(0);
  });

  it('silently drops a honeypot-tripped submission (200, no write)', async () => {
    const res = await submitPublicIntakeAction({ ...validAdult, website: 'http://spam' });
    expect(res.ok).toBe(true);
    expect(h.createCalls).toHaveLength(0);
  });

  it('blocks when the IP is rate-limited', async () => {
    h.rateLimitAllowed.value = false;
    const res = await submitPublicIntakeAction(validAdult);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INTAKE_SUBMISSION_RATE_LIMITED');
    expect(h.createCalls).toHaveLength(0);
  });

  it('rejects an oversized payload before validation', async () => {
    const res = await submitPublicIntakeAction({
      ...validAdult,
      answers: { ...adultAnswers, customAnswers: { big: 'x'.repeat(70_000) } },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INTAKE_SUBMISSION_TOO_LARGE');
    expect(h.createCalls).toHaveLength(0);
  });
});
