import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P52 — token-authorized intake submission. The security-critical piece:
 * single-use (race-safe), identity fields (name/phone) can NEVER be
 * overwritten via the payload, and unknown/used tokens fail identically.
 */

const state = {
  link: null as {
    id: string;
    patientId: string;
    formType: 'ADULT' | 'PEDIATRIC';
    usedAt: Date | null;
  } | null,
  claimCount: 1,
  userUpdates: [] as Array<Record<string, unknown>>,
  profileUpdates: [] as Array<Record<string, unknown>>,
  intakeCreated: [] as Array<Record<string, unknown>>,
  linkClaims: [] as Array<Record<string, unknown>>,
};

vi.mock('@/lib/intake/services', () => ({ buildAnswerRows: vi.fn(async () => []) }));
vi.mock('@/lib/system/actor', () => ({ SYSTEM_USER_ID: 'system' }));

vi.mock('@/lib/db', () => {
  const tx = {
    patientIntakeLink: {
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        state.linkClaims.push(args);
        return { count: state.claimCount };
      }),
    },
    user: { update: vi.fn(async (a: Record<string, unknown>) => state.userUpdates.push(a)) },
    patientProfile: {
      update: vi.fn(async (a: Record<string, unknown>) => state.profileUpdates.push(a)),
    },
    intakeAssessment: { create: vi.fn(async () => ({ id: 'intake-1' })) },
    adultIntakeData: {
      create: vi.fn(async (a: Record<string, unknown>) => state.intakeCreated.push(a)),
    },
    pediatricIntakeData: {
      create: vi.fn(async (a: Record<string, unknown>) => state.intakeCreated.push(a)),
    },
    intakeCustomAnswer: { createMany: vi.fn(async () => undefined) },
    auditLog: { create: vi.fn(async () => undefined) },
  };
  return {
    db: {
      patientIntakeLink: { findUnique: vi.fn(async () => state.link) },
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

import { IntakeLinkSubmitError, submitIntakeViaLink } from '../submit';

const TOKEN = 'a'.repeat(43);
const adultAnswers = {
  physicalActivityLevel: 'MODERATE',
  primaryComplaint: 'back pain',
  painTiming: 'DAY',
  symptomDuration: 'WEEKS_2_3',
  painSeverity: 'FIVE',
  painStability: 'CONSTANT',
  conditions: ['NONE'],
  referralSource: 'FRIEND_FAMILY',
  customAnswers: {},
};
const payload = (over: Record<string, unknown> = {}) => ({
  token: TOKEN,
  type: 'ADULT',
  locale: 'en',
  website: '',
  profile: {
    fullNameEn: 'HACKER OVERWRITE',
    phone: '0000000000',
    dateOfBirth: '1990-05-01',
    gender: 'MALE',
    address: 'Amman',
    email: 'x@y.com',
  },
  answers: adultAnswers,
  ...over,
});

beforeEach(() => {
  state.link = { id: 'link-1', patientId: 'pat-1', formType: 'ADULT', usedAt: null };
  state.claimCount = 1;
  state.userUpdates = [];
  state.profileUpdates = [];
  state.intakeCreated = [];
  state.linkClaims = [];
});

describe('submitIntakeViaLink', () => {
  it('a valid unused token persists the intake and updates DOB/gender — but NOT identity', async () => {
    await expect(submitIntakeViaLink(payload())).resolves.toEqual({ ok: true });
    const profile = state.profileUpdates[0]!.data as Record<string, unknown>;
    expect(profile.gender).toBe('MALE');
    expect(profile).not.toHaveProperty('fullNameEn');
    expect(profile).not.toHaveProperty('phone');
    const user = state.userUpdates[0]!.data as Record<string, unknown>;
    expect(user).not.toHaveProperty('fullNameEn');
    expect(user).not.toHaveProperty('phone');
    expect(state.intakeCreated).toHaveLength(1);
  });

  it('claims the link single-use (usedAt set where still null)', async () => {
    await submitIntakeViaLink(payload());
    expect(state.linkClaims[0]).toMatchObject({
      where: { id: 'link-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('an already-used token → INVALID_LINK (no persistence)', async () => {
    state.link = { id: 'link-1', patientId: 'pat-1', formType: 'ADULT', usedAt: new Date() };
    await expect(submitIntakeViaLink(payload())).rejects.toBeInstanceOf(IntakeLinkSubmitError);
    expect(state.intakeCreated).toHaveLength(0);
  });

  it('an unknown token → INVALID_LINK (same failure, no data)', async () => {
    state.link = null;
    await expect(submitIntakeViaLink(payload())).rejects.toMatchObject({ code: 'INVALID_LINK' });
  });

  it('a race that loses the claim (count 0) → INVALID_LINK', async () => {
    state.claimCount = 0;
    await expect(submitIntakeViaLink(payload())).rejects.toMatchObject({ code: 'INVALID_LINK' });
  });

  it('a form-type mismatch (PEDIATRIC token, ADULT payload) is rejected', async () => {
    state.link = { id: 'link-1', patientId: 'pat-1', formType: 'PEDIATRIC', usedAt: null };
    await expect(submitIntakeViaLink(payload())).rejects.toMatchObject({
      code: 'FORM_TYPE_MISMATCH',
    });
  });

  it('a malformed payload → VALIDATION (never reaches the db)', async () => {
    await expect(submitIntakeViaLink({ token: TOKEN, type: 'ADULT' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
