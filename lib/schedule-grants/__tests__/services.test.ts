import { beforeEach, describe, expect, it, vi } from 'vitest';

/** P64 #4 — schedule view grants: who may be a viewer / owner, no dupes. */

vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_cfg: unknown, fn: unknown) => fn,
}));
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'sec-1', role: 'SECRETARY' } })),
}));

vi.mock('@/lib/db', () => {
  const state = {
    users: [] as Array<{ id: string; role: string; deletedAt: Date | null }>,
    grants: [] as Array<{ id: string; viewerId: string; ownerId: string; createdById: string }>,
  };
  type Where = { id: string; deletedAt: null; role: string | { in: string[] } };
  const roleOk = (role: string, want: Where['role']) =>
    typeof want === 'string' ? role === want : want.in.includes(role);
  return {
    __state: state,
    toLocalizedError: (e: unknown) => ({ code: 'X', message_en: String(e), message_ar: '' }),
    db: {
      user: {
        findFirst: vi.fn(async ({ where }: { where: Where }) => {
          const u = state.users.find(
            (x) => x.id === where.id && x.deletedAt === null && roleOk(x.role, where.role),
          );
          return u ? { id: u.id } : null;
        }),
      },
      scheduleViewGrant: {
        findUnique: vi.fn(
          async ({
            where,
          }: {
            where: { id?: string; viewerId_ownerId?: { viewerId: string; ownerId: string } };
          }) => {
            const g = where.id
              ? state.grants.find((x) => x.id === where.id)
              : state.grants.find(
                  (x) =>
                    x.viewerId === where.viewerId_ownerId!.viewerId &&
                    x.ownerId === where.viewerId_ownerId!.ownerId,
                );
            return g ? { id: g.id } : null;
          },
        ),
        create: vi.fn(
          async ({
            data,
          }: {
            data: { viewerId: string; ownerId: string; createdById: string };
          }) => {
            const row = { id: `g${state.grants.length + 1}`, ...data };
            state.grants.push(row);
            return { id: row.id };
          },
        ),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          state.grants = state.grants.filter((g) => g.id !== where.id);
        }),
      },
    },
  };
});

import { createScheduleGrant, deleteScheduleGrant } from '../services';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    users: Array<{ id: string; role: string; deletedAt: Date | null }>;
    grants: Array<{ id: string; viewerId: string; ownerId: string; createdById: string }>;
  };
};

beforeEach(() => {
  __state.grants = [];
  __state.users = [
    { id: 'th-1', role: 'THERAPIST', deletedAt: null },
    { id: 'th-2', role: 'THERAPIST', deletedAt: null },
    { id: 'dr-1', role: 'DOCTOR', deletedAt: null },
    { id: 'th-gone', role: 'THERAPIST', deletedAt: new Date() },
  ];
});

describe('createScheduleGrant', () => {
  it('therapist → therapist and therapist → doctor are allowed; actor recorded', async () => {
    await createScheduleGrant({ viewerId: 'th-1', ownerId: 'th-2' });
    await createScheduleGrant({ viewerId: 'th-1', ownerId: 'dr-1' });
    expect(__state.grants).toHaveLength(2);
    expect(__state.grants[0]).toMatchObject({ viewerId: 'th-1', createdById: 'sec-1' });
  });

  it('a doctor cannot be the viewer (they already read the whole calendar)', async () => {
    await expect(createScheduleGrant({ viewerId: 'dr-1', ownerId: 'th-1' })).rejects.toMatchObject({
      error: { code: 'GRANT_BAD_VIEWER' },
    });
  });

  it('rejects self, deleted owners and duplicates', async () => {
    await expect(createScheduleGrant({ viewerId: 'th-1', ownerId: 'th-1' })).rejects.toMatchObject({
      error: { code: 'GRANT_SELF' },
    });
    await expect(
      createScheduleGrant({ viewerId: 'th-1', ownerId: 'th-gone' }),
    ).rejects.toMatchObject({ error: { code: 'GRANT_BAD_OWNER' } });
    await createScheduleGrant({ viewerId: 'th-1', ownerId: 'th-2' });
    await expect(createScheduleGrant({ viewerId: 'th-1', ownerId: 'th-2' })).rejects.toMatchObject({
      error: { code: 'GRANT_DUPLICATE' },
    });
  });

  it('is directional — th-1 → th-2 does not let th-2 see th-1', async () => {
    await createScheduleGrant({ viewerId: 'th-1', ownerId: 'th-2' });
    await createScheduleGrant({ viewerId: 'th-2', ownerId: 'th-1' });
    expect(__state.grants).toHaveLength(2);
  });
});

describe('deleteScheduleGrant', () => {
  it('revokes; a second revoke is NOT_FOUND', async () => {
    const g = await createScheduleGrant({ viewerId: 'th-1', ownerId: 'th-2' });
    await deleteScheduleGrant({ grantId: g.id });
    expect(__state.grants).toHaveLength(0);
    await expect(deleteScheduleGrant({ grantId: g.id })).rejects.toMatchObject({
      error: { code: 'GRANT_NOT_FOUND' },
    });
  });
});
