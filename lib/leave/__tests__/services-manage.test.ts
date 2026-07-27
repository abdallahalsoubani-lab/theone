import { AuditAction, LeaveStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 55 §1 — direct leave management (Admin + Secretary).
 *
 * createLeaveForUser: created APPROVED in ONE step (no request/approval hop),
 * approvedById = the actor, optional note, PATIENT/archived targets rejected,
 * and the same retrospective conflict scan as approveLeave fans out inbox
 * items. deleteLeave: hard delete ("end early") — the calendar overlay and
 * the conflict engine read live rows. Both audited (config captured here;
 * the RBAC gate lives in the actions + the can() matrix test).
 */

const { audited } = vi.hoisted(() => ({
  audited: { configs: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (cfg: Record<string, unknown>, fn: unknown) => {
    audited.configs.push(cfg);
    return fn;
  },
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'actor-admin', role: 'ADMIN' } })),
}));

vi.mock('@/lib/notifications/actions', () => ({
  createNotification: vi.fn(async () => ({})),
}));

vi.mock('../conflictScan', () => ({
  scanLeaveConflicts: vi.fn(async () => []),
}));

vi.mock('@/lib/db', () => {
  interface LeaveRec {
    id: string;
    userId: string;
    leaveType: string;
    startDate: Date;
    endDate: Date;
    reason: string | null;
    status: string;
    approvedById: string | null;
  }
  const state = {
    users: [] as Array<{ id: string; role: string; deletedAt: Date | null }>,
    leaves: [] as LeaveRec[],
    inboxItems: [] as Array<Record<string, unknown>>,
    seq: 0,
  };
  return {
    __state: state,
    db: {
      user: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          const u = state.users.find(
            (x) => x.id === where.id && x.deletedAt === null && x.role !== 'PATIENT',
          );
          return u ? { id: u.id } : null;
        }),
      },
      leave: {
        create: vi.fn(async ({ data }: { data: Omit<LeaveRec, 'id'> }) => {
          state.seq += 1;
          const rec = { id: `leave-${state.seq}`, ...data };
          state.leaves.push(rec);
          return { id: rec.id };
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          return state.leaves.find((l) => l.id === where.id) ?? null;
        }),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          const i = state.leaves.findIndex((l) => l.id === where.id);
          if (i < 0) throw new Error('record not found');
          state.leaves.splice(i, 1);
          return {};
        }),
      },
      inboxItem: {
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          state.inboxItems.push(...data);
          return { count: data.length };
        }),
      },
    },
    toLocalizedError: (err: unknown) => ({
      code: 'UNKNOWN',
      message_en: String(err),
      message_ar: String(err),
    }),
  };
});

import { scanLeaveConflicts } from '../conflictScan';
import { createLeaveForUser, deleteLeave, LeaveError } from '../services';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    users: Array<{ id: string; role: string; deletedAt: Date | null }>;
    leaves: Array<{
      id: string;
      userId: string;
      reason: string | null;
      status: string;
      approvedById: string | null;
      startDate: Date;
      endDate: Date;
    }>;
    inboxItems: Array<Record<string, unknown>>;
    seq: number;
  };
};

const scanMock = vi.mocked(scanLeaveConflicts);

const range = {
  startDate: new Date('2026-08-03T00:00:00Z'),
  endDate: new Date('2026-08-05T00:00:00Z'),
};

beforeEach(() => {
  __state.users.length = 0;
  __state.leaves.length = 0;
  __state.inboxItems.length = 0;
  __state.seq = 0;
  scanMock.mockClear();
  scanMock.mockResolvedValue([]);
  __state.users.push(
    { id: 'th-1', role: 'THERAPIST', deletedAt: null },
    { id: 'p-1', role: 'PATIENT', deletedAt: null },
    { id: 'th-gone', role: 'THERAPIST', deletedAt: new Date() },
  );
});

describe('createLeaveForUser (direct add)', () => {
  it('creates the leave APPROVED with approvedById = actor; empty note stored as null', async () => {
    const r = await createLeaveForUser({ userId: 'th-1', leaveType: 'VACATION', ...range });
    expect(r.targetUserId).toBe('th-1');
    expect(r.conflictCount).toBe(0);
    expect(__state.leaves).toHaveLength(1);
    expect(__state.leaves[0]).toMatchObject({
      userId: 'th-1',
      status: LeaveStatus.APPROVED,
      approvedById: 'actor-admin',
      reason: null,
    });
  });

  it('stores a trimmed note when provided', async () => {
    await createLeaveForUser({
      userId: 'th-1',
      leaveType: 'SICK',
      note: '  سفر عائلي  ',
      ...range,
    });
    expect(__state.leaves[0]!.reason).toBe('سفر عائلي');
  });

  it('rejects a PATIENT target and an archived staff member', async () => {
    for (const userId of ['p-1', 'th-gone', 'nobody']) {
      await expect(
        createLeaveForUser({ userId, leaveType: 'VACATION', ...range }),
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof LeaveError && e.error.code === 'LEAVE_TARGET_INVALID',
      );
    }
    expect(__state.leaves).toHaveLength(0);
  });

  it('fans conflict-scan hits out as LEAVE_CONFLICT inbox items and reports the count', async () => {
    scanMock.mockResolvedValue([
      {
        appointmentId: 'appt-1',
        patientId: 'p-1',
        patientFullNameEn: 'John',
        patientFullNameAr: 'جون',
        startsAt: new Date('2026-08-03T07:00:00Z'),
        durationMinutes: 60,
      },
    ]);
    const r = await createLeaveForUser({ userId: 'th-1', leaveType: 'PERSONAL', ...range });
    expect(r.conflictCount).toBe(1);
    expect(__state.inboxItems).toHaveLength(1);
    expect(__state.inboxItems[0]).toMatchObject({
      type: 'LEAVE_CONFLICT',
      appointmentId: 'appt-1',
      leaveId: r.leaveId,
    });
  });

  it('is wrapped in withAudit as a Leave CREATE', () => {
    expect(audited.configs).toContainEqual(
      expect.objectContaining({ entityType: 'Leave', action: AuditAction.CREATE }),
    );
  });
});

describe('deleteLeave (delete / end early)', () => {
  it('removes the row and returns the removed window for the audit snapshot', async () => {
    await createLeaveForUser({ userId: 'th-1', leaveType: 'VACATION', ...range });
    const id = __state.leaves[0]!.id;
    const r = await deleteLeave({ id });
    expect(r).toMatchObject({
      leaveId: id,
      targetUserId: 'th-1',
      startDate: '2026-08-03',
      endDate: '2026-08-05',
      status: LeaveStatus.APPROVED,
    });
    expect(__state.leaves).toHaveLength(0);
  });

  it('throws LEAVE_NOT_FOUND for a missing id', async () => {
    await expect(deleteLeave({ id: 'nope' })).rejects.toSatisfy(
      (e: unknown) => e instanceof LeaveError && e.error.code === 'LEAVE_NOT_FOUND',
    );
  });

  it('is wrapped in withAudit as a Leave DELETE', () => {
    expect(audited.configs).toContainEqual(
      expect.objectContaining({ entityType: 'Leave', action: AuditAction.DELETE }),
    );
  });
});
