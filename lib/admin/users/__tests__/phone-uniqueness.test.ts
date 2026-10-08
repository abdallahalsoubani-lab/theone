import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P62 follow-up — the admin create/update duplicate pre-check must mirror
 * the DB rule (`User_phone_unique_active_staff`, migration 20260726): a
 * phone is unique among ACTIVE STAFF only, so a patient row holding the
 * same number must NOT block saving it on a staff account. Email stays a
 * global uniqueness check. Regression for the production report «مش راضي
 * يحطو» when a therapist's number already existed on a patient record.
 */

const state = {
  conflict: null as { id: string } | null,
  wheres: [] as Array<Record<string, unknown>>,
};

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'admin-1', role: 'ADMIN' } })),
}));
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit:
    (_cfg: unknown, fn: (...a: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async () => 'hash') }));
vi.mock('@/lib/admin/temp-password', () => ({
  generateTempPassword: vi.fn(() => 'Temp-Pass-1234'),
}));
vi.mock('@/lib/admin/users/queries', () => ({ countActiveAdmins: vi.fn(async () => 2) }));
vi.mock('@/lib/db', () => {
  const tx = {
    user: {
      create: vi.fn(async () => ({ id: 'u-new' })),
      update: vi.fn(async () => ({ id: 'u-1' })),
    },
    userSpecialty: {
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return {
    db: {
      user: {
        findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
          state.wheres.push(args.where);
          return state.conflict;
        }),
        findUnique: vi.fn(async () => ({ role: 'THERAPIST', deletedAt: null })),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
    toLocalizedError: (e: unknown) => e,
  };
});

import { createUser, updateUser, UserAdminError } from '../services';

const BASE = {
  fullNameEn: 'Alaa Shmeilan',
  fullNameAr: 'الاء شميلان',
  email: 'alaa@theonephysio.com',
  role: 'THERAPIST' as const,
  languagePref: 'AR' as const,
  specialtyIds: [],
  mustChangePassword: false,
};

beforeEach(() => {
  state.conflict = null;
  state.wheres = [];
});

describe('staff phone uniqueness pre-check (create)', () => {
  it('scopes the phone clause to NON-PATIENT roles; the email clause stays global', async () => {
    await createUser({ ...BASE, phone: '+962788453529' });
    expect(state.wheres).toHaveLength(1);
    expect(state.wheres[0]).toEqual({
      deletedAt: null,
      OR: [
        { email: 'alaa@theonephysio.com' },
        { phone: '+962788453529', role: { not: 'PATIENT' } },
      ],
    });
  });

  it('no phone → only the email clause participates (P50 null rule)', async () => {
    await createUser({ ...BASE, phone: null });
    expect(state.wheres[0]).toEqual({
      deletedAt: null,
      OR: [{ email: 'alaa@theonephysio.com' }],
    });
  });

  it('a genuine staff conflict still throws DUPLICATE_IDENTIFIER', async () => {
    state.conflict = { id: 'other-staff' };
    await expect(createUser({ ...BASE, phone: '+962788453529' })).rejects.toBeInstanceOf(
      UserAdminError,
    );
  });
});

describe('staff phone uniqueness pre-check (update)', () => {
  it('excludes the row itself and scopes the phone clause to NON-PATIENT roles', async () => {
    await updateUser({ ...BASE, id: 'u-1', phone: '+962788453529' });
    expect(state.wheres[0]).toEqual({
      id: { not: 'u-1' },
      deletedAt: null,
      OR: [
        { email: 'alaa@theonephysio.com' },
        { phone: '+962788453529', role: { not: 'PATIENT' } },
      ],
    });
  });

  it('lower-cases the email before comparing', async () => {
    await updateUser({ ...BASE, id: 'u-1', email: 'Alaa@TheOnePhysio.com', phone: null });
    expect(state.wheres[0]).toMatchObject({ OR: [{ email: 'alaa@theonephysio.com' }] });
  });
});
