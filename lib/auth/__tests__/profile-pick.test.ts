import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as LockoutModule from '../lockout';

/**
 * P57 — patient OTP login on a shared family number: one OTP, then a
 * profile picker. Covers the pick-token lifecycle, the server action
 * branches (single → direct sign-in unchanged; several → picker, no session
 * yet), and the provider's picker branch (chosen patient must be active and
 * on that phone; token single-use).
 */

const redisStore = new Map<string, string>();

vi.mock('@/lib/redis/client', () => {
  const chain = () => {
    const ops: Array<() => unknown> = [];
    const api = {
      get: (k: string) => {
        ops.push(() => redisStore.get(k) ?? null);
        return api;
      },
      del: (k: string) => {
        ops.push(() => (redisStore.delete(k) ? 1 : 0));
        return api;
      },
      exec: async () => ops.map((op) => [null, op()]),
    };
    return api;
  };
  return {
    redis: {
      set: vi.fn(async (k: string, v: string) => {
        redisStore.set(k, v);
        return 'OK';
      }),
      get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
      del: vi.fn(async (k: string) => (redisStore.delete(k) ? 1 : 0)),
      multi: vi.fn(chain),
    },
  };
});

interface U {
  id: string;
  phone: string | null;
  role: string;
  deletedAt: Date | null;
  fullNameEn: string;
  fullNameAr: string;
  languagePref: 'AR' | 'EN';
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  email: string | null;
  createdAt: Date;
  dateOfBirth: Date;
}
const state = { users: [] as U[] };
const matches = (u: U, where: Record<string, unknown>) =>
  (where.id === undefined || u.id === where.id) &&
  (where.phone === undefined || u.phone === where.phone) &&
  (where.role === undefined || u.role === where.role) &&
  (!('deletedAt' in where) || u.deletedAt === where.deletedAt);

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.users
          .filter((u) => matches(u, where))
          .map((u) => ({ ...u, patientProfile: { dateOfBirth: u.dateOfBirth } })),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          state.users.find((u) => matches(u, where)) ?? null,
      ),
      update: vi.fn(async () => ({})),
    },
  },
}));

const { signInMock, verifyOtpMock } = vi.hoisted(() => ({
  signInMock: vi.fn(async () => undefined),
  verifyOtpMock: vi.fn(async () => ({ ok: true }) as { ok: boolean; reason?: string }),
}));
vi.mock('@/auth', () => ({ signIn: signInMock }));
// next-auth's runtime pulls `next/server` (absent under Vitest); the tests only
// need the provider CONFIG object and the AuthError class.
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));
vi.mock('next-auth/providers/credentials', () => ({
  default: (cfg: Record<string, unknown>) => ({ ...cfg, type: 'credentials' }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-real-ip': '1.2.3.4' }) }));
vi.mock('@/lib/auth/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/auth/otp', () => ({ verifyOtp: verifyOtpMock }));
vi.mock('./senders', () => ({ otpSender: { sendOtp: vi.fn() } }));
vi.mock('@/lib/auth/lockout', async (importOriginal) => {
  const actual = await importOriginal<typeof LockoutModule>();
  return {
    ...actual,
    recordFailedAttempt: vi.fn(async () => undefined),
    recordSuccessfulAttempt: vi.fn(async () => undefined),
  };
});

import {
  consumeProfilePickToken,
  listPickableProfiles,
  mintProfilePickToken,
  peekProfilePickToken,
} from '../profile-pick';
import { providers } from '../providers';
import { signInAsPickedPatient, verifyOtpAndSignIn } from '../actions/login';

const PHONE = '+962790000000';
function user(id: string, extra: Partial<U> = {}): U {
  return {
    id,
    phone: PHONE,
    role: 'PATIENT',
    deletedAt: null,
    fullNameEn: id,
    fullNameAr: '',
    languagePref: 'AR',
    mustChangePassword: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    email: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    dateOfBirth: new Date('2015-05-05T00:00:00Z'),
    ...extra,
  };
}

const phoneOtpProvider = () => {
  const p = providers.find((x) => (x as { id?: string }).id === 'phone-otp') as unknown as {
    authorize: (raw: Record<string, unknown>) => Promise<{ id: string } | null>;
  };
  return p.authorize;
};

beforeEach(() => {
  redisStore.clear();
  state.users = [];
  signInMock.mockClear();
  verifyOtpMock.mockClear();
  verifyOtpMock.mockResolvedValue({ ok: true });
});

describe('pick token lifecycle', () => {
  it('mints a 64-hex token bound to the phone, peek is non-consuming, consume is single-use', async () => {
    const token = await mintProfilePickToken(PHONE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await peekProfilePickToken(token)).toBe(PHONE);
    expect(await peekProfilePickToken(token)).toBe(PHONE);
    expect(await consumeProfilePickToken(token)).toBe(PHONE);
    expect(await consumeProfilePickToken(token)).toBeNull();
    expect(await peekProfilePickToken(token)).toBeNull();
  });

  it('lists only ACTIVE patients on the phone, with the birth year (null for placeholder DOB)', async () => {
    state.users.push(
      user('child-a'),
      user('child-b', { dateOfBirth: new Date('1900-01-01T00:00:00Z') }),
      user('archived', { deletedAt: new Date() }),
      user('sec', { role: 'SECRETARY' }),
    );
    const list = await listPickableProfiles(PHONE);
    expect(list.map((p) => p.id)).toEqual(['child-a', 'child-b']);
    expect(list[0]!.dobYear).toBe(2015);
    expect(list[1]!.dobYear).toBeNull();
  });
});

describe('verifyOtpAndSignIn', () => {
  it('single patient → signs in through the provider exactly as before (no picker)', async () => {
    state.users.push(user('only'));
    const r = await verifyOtpAndSignIn({ phone: PHONE, otp: '123456' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pick).toBeUndefined();
    expect(r.data.redirectTo).toBe('/patient/dashboard');
    expect(signInMock).toHaveBeenCalledWith('phone-otp', {
      phone: PHONE,
      otp: '123456',
      redirect: false,
    });
    // The OTP is verified INSIDE the provider on this path — not here.
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it('shared number → verifies the OTP once, returns the picker, creates NO session', async () => {
    state.users.push(user('child-a'), user('child-b'), user('gone', { deletedAt: new Date() }));
    const r = await verifyOtpAndSignIn({ phone: PHONE, otp: '123456' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(verifyOtpMock).toHaveBeenCalledTimes(1);
    expect(signInMock).not.toHaveBeenCalled();
    expect(r.data.redirectTo).toBeNull();
    expect(r.data.pick?.patients.map((p) => p.id)).toEqual(['child-a', 'child-b']);
    expect(await peekProfilePickToken(r.data.pick!.token)).toBe(PHONE);
  });

  it('shared number + wrong code → the OTP error, never "invalid credentials", no token minted', async () => {
    state.users.push(user('child-a'), user('child-b'));
    verifyOtpMock.mockResolvedValueOnce({ ok: false, reason: 'OTP_INVALID' });
    const r = await verifyOtpAndSignIn({ phone: PHONE, otp: '000000' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('OTP_INVALID');
    expect(redisStore.size).toBe(0);
  });
});

describe('signInAsPickedPatient + provider picker branch', () => {
  it('each selection lands in ITS OWN account; the token is consumed by the provider', async () => {
    state.users.push(user('child-a'), user('child-b'));
    const authorize = phoneOtpProvider();

    const tokenA = await mintProfilePickToken(PHONE);
    const ra = await signInAsPickedPatient({ token: tokenA, patientId: 'child-a' });
    expect(ra.ok).toBe(true);
    expect(signInMock).toHaveBeenLastCalledWith('phone-otp', {
      phone: PHONE,
      pickToken: tokenA,
      patientId: 'child-a',
      redirect: false,
    });
    const userA = await authorize({ phone: PHONE, pickToken: tokenA, patientId: 'child-a' });
    expect(userA?.id).toBe('child-a');
    // Single use: replaying the same token fails closed.
    expect(await authorize({ phone: PHONE, pickToken: tokenA, patientId: 'child-a' })).toBeNull();

    const tokenB = await mintProfilePickToken(PHONE);
    const userB = await authorize({ phone: PHONE, pickToken: tokenB, patientId: 'child-b' });
    expect(userB?.id).toBe('child-b');
  });

  it('refuses a patient not on that phone, an archived patient, or a foreign phone', async () => {
    state.users.push(
      user('child-a'),
      user('child-b'),
      user('stranger', { phone: '+962799999999' }),
      user('archived', { deletedAt: new Date() }),
    );
    const authorize = phoneOtpProvider();

    const t1 = await mintProfilePickToken(PHONE);
    const r1 = await signInAsPickedPatient({ token: t1, patientId: 'stranger' });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe('PICK_INVALID');
    expect(await authorize({ phone: PHONE, pickToken: t1, patientId: 'stranger' })).toBeNull();

    const t2 = await mintProfilePickToken(PHONE);
    expect(await authorize({ phone: PHONE, pickToken: t2, patientId: 'archived' })).toBeNull();

    const t3 = await mintProfilePickToken(PHONE);
    expect(
      await authorize({ phone: '+962799999999', pickToken: t3, patientId: 'stranger' }),
    ).toBeNull();
  });

  it('an expired / unknown token is PICK_INVALID (never "invalid credentials")', async () => {
    state.users.push(user('child-a'), user('child-b'));
    const r = await signInAsPickedPatient({ token: 'f'.repeat(64), patientId: 'child-a' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PICK_INVALID');
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('provider: the OTP path still requires a code and still refuses a shared number', async () => {
    const authorize = phoneOtpProvider();
    state.users.push(user('only'));
    expect(await authorize({ phone: PHONE })).toBeNull();
    expect((await authorize({ phone: PHONE, otp: '123456' }))?.id).toBe('only');
    state.users.push(user('sibling'));
    expect(await authorize({ phone: PHONE, otp: '123456' })).toBeNull();
  });
});
