import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NOTIFICATION_TEMPLATES } from '../templates';

// In-memory db stub. Each test mutates state directly via the helpers
// exported via the mock factory.
vi.mock('@/lib/db', () => {
  const state = {
    notifications: [] as Array<{
      id: string;
      recipientId: string;
      type: string;
      titleKey: string;
      bodyKey: string;
      params: Record<string, unknown>;
      linkPath: string | null;
      relatedEntityType: string | null;
      relatedEntityId: string | null;
      readAt: Date | null;
      createdAt: Date;
    }>,
    auditLogs: [] as Array<Record<string, unknown>>,
    counter: 0,
  };
  return {
    __state: state,
    db: {
      notification: {
        create: vi.fn(
          async ({ data, select }: { data: Record<string, unknown>; select?: { id: boolean } }) => {
            state.counter += 1;
            const id = `notif-${state.counter}`;
            const row = {
              id,
              recipientId: data.recipientId as string,
              type: data.type as string,
              titleKey: data.titleKey as string,
              bodyKey: data.bodyKey as string,
              params: (data.params ?? {}) as Record<string, unknown>,
              linkPath: (data.linkPath as string | null) ?? null,
              relatedEntityType: (data.relatedEntityType as string | null) ?? null,
              relatedEntityId: (data.relatedEntityId as string | null) ?? null,
              readAt: null,
              createdAt: new Date(),
            };
            state.notifications.push(row);
            return select?.id ? { id } : row;
          },
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id?: string; recipientId?: string; readAt?: null };
            data: { readAt: Date };
          }) => {
            let count = 0;
            for (const n of state.notifications) {
              if (where.id != null && n.id !== where.id) continue;
              if (where.recipientId != null && n.recipientId !== where.recipientId) continue;
              if (where.readAt === null && n.readAt !== null) continue;
              n.readAt = data.readAt;
              count += 1;
            }
            return { count };
          },
        ),
        count: vi.fn(async ({ where }: { where: { recipientId?: string; readAt?: null } }) => {
          return state.notifications.filter((n) => {
            if (where.recipientId != null && n.recipientId !== where.recipientId) return false;
            if (where.readAt === null && n.readAt !== null) return false;
            return true;
          }).length;
        }),
        findMany: vi.fn(async () => state.notifications.slice()),
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

// Authentication stub — defaults to a session user; tests override per case.
vi.mock('@/auth', () => {
  let session: { user: { id: string; role: string } } | null = {
    user: { id: 'user-1', role: 'DOCTOR' },
  };
  return {
    auth: vi.fn(async () => session),
    __setSession: (s: typeof session) => {
      session = s;
    },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/rbac/guards', () => ({
  requirePermission: vi.fn(async () => ({ id: 'user-1', role: 'DOCTOR' })),
}));

import * as dbModule from '@/lib/db';
import * as authModule from '@/auth';
import {
  createNotification,
  getUnreadNotificationCountAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '../actions';

const state = (
  dbModule as unknown as {
    __state: {
      notifications: Array<{ id: string; recipientId: string; readAt: Date | null }>;
      auditLogs: Array<Record<string, unknown>>;
      counter: number;
    };
  }
).__state;
const setSession = (authModule as unknown as { __setSession: (s: unknown) => void }).__setSession;

beforeEach(() => {
  state.notifications.length = 0;
  state.auditLogs.length = 0;
  state.counter = 0;
  setSession({ user: { id: 'user-1', role: 'DOCTOR' } });
});

describe('createNotification', () => {
  it('inserts a row with the looked-up i18n keys from the template map', async () => {
    await createNotification({
      recipientId: 'therapist-1',
      type: 'PLAN_ASSIGNED',
      params: { doctorName: 'Sara', patientName: 'Sara K' },
    });
    expect(state.notifications).toHaveLength(1);
    const row = state.notifications[0]! as unknown as { titleKey: string; bodyKey: string };
    expect(row.titleKey).toBe(NOTIFICATION_TEMPLATES.PLAN_ASSIGNED.titleKey);
    expect(row.bodyKey).toBe(NOTIFICATION_TEMPLATES.PLAN_ASSIGNED.bodyKey);
  });

  it('carries linkPath + relatedEntity fields through', async () => {
    await createNotification({
      recipientId: 'therapist-1',
      type: 'PLAN_ASSIGNED',
      params: { doctorName: 'Sara', patientName: 'Sara K' },
      linkPath: '/therapist/plans/p-1',
      relatedEntityType: 'TreatmentPlan',
      relatedEntityId: 'p-1',
    });
    const row = state.notifications[0]! as unknown as {
      linkPath: string | null;
      relatedEntityType: string | null;
      relatedEntityId: string | null;
    };
    expect(row.linkPath).toBe('/therapist/plans/p-1');
    expect(row.relatedEntityType).toBe('TreatmentPlan');
    expect(row.relatedEntityId).toBe('p-1');
  });

  it('logs an audit row asynchronously with the current actor', async () => {
    await createNotification({
      recipientId: 'therapist-1',
      type: 'PLAN_ASSIGNED',
      params: { doctorName: 'Sara', patientName: 'Sara K' },
    });
    // Audit insert is fire-and-forget; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      actorId: 'user-1',
      entityType: 'Notification',
    });
  });
});

describe('markNotificationReadAction', () => {
  it('marks only the recipient’s row read', async () => {
    state.notifications.push(
      { id: 'n-1', recipientId: 'user-1', readAt: null },
      { id: 'n-2', recipientId: 'user-2', readAt: null },
    );
    const r = await markNotificationReadAction('n-1');
    expect(r).toEqual({ ok: true });
    expect(state.notifications[0]!.readAt).not.toBeNull();
    expect(state.notifications[1]!.readAt).toBeNull();
  });

  it('refuses to mark someone else’s notification (no row matched, no error)', async () => {
    state.notifications.push({ id: 'n-other', recipientId: 'user-2', readAt: null });
    const r = await markNotificationReadAction('n-other');
    expect(r).toEqual({ ok: true });
    expect(state.notifications[0]!.readAt).toBeNull();
  });

  it('is idempotent when called twice', async () => {
    state.notifications.push({ id: 'n-1', recipientId: 'user-1', readAt: null });
    await markNotificationReadAction('n-1');
    const firstRead = state.notifications[0]!.readAt;
    await markNotificationReadAction('n-1');
    // updateMany has a `readAt: null` filter, so the second call updates 0 rows.
    expect(state.notifications[0]!.readAt).toBe(firstRead);
  });
});

describe('markAllNotificationsReadAction', () => {
  it('marks every unread row for the current user only', async () => {
    state.notifications.push(
      { id: 'n-1', recipientId: 'user-1', readAt: null },
      { id: 'n-2', recipientId: 'user-1', readAt: null },
      { id: 'n-3', recipientId: 'user-2', readAt: null },
    );
    const r = await markAllNotificationsReadAction();
    expect(r).toEqual({ ok: true, count: 2 });
    expect(state.notifications[0]!.readAt).not.toBeNull();
    expect(state.notifications[1]!.readAt).not.toBeNull();
    expect(state.notifications[2]!.readAt).toBeNull();
  });

  it('returns count=0 when there are no unread rows', async () => {
    const r = await markAllNotificationsReadAction();
    expect(r).toEqual({ ok: true, count: 0 });
  });
});

describe('getUnreadNotificationCountAction', () => {
  it('returns the count of the current user’s unread rows', async () => {
    state.notifications.push(
      { id: 'n-1', recipientId: 'user-1', readAt: null },
      { id: 'n-2', recipientId: 'user-1', readAt: new Date() },
      { id: 'n-3', recipientId: 'user-1', readAt: null },
      { id: 'n-4', recipientId: 'user-2', readAt: null },
    );
    await expect(getUnreadNotificationCountAction()).resolves.toBe(2);
  });

  it('returns 0 when unauthenticated', async () => {
    setSession(null);
    await expect(getUnreadNotificationCountAction()).resolves.toBe(0);
  });
});

describe('NOTIFICATION_TEMPLATES map', () => {
  it('covers every NotificationType value (no leaks)', () => {
    const types = [
      'PLAN_ASSIGNED',
      'PLAN_PROPOSAL_RECEIVED',
      'PLAN_PROPOSAL_APPROVED',
      'PLAN_PROPOSAL_REJECTED',
      'PLAN_PAUSED',
      'PLAN_DISCONTINUED',
      'DAY_REPORT_SUBMITTED',
      'DOCTOR_REVIEW_ADDED',
      'APPOINTMENT_RESCHEDULE_REQUEST',
    ] as const;
    for (const t of types) {
      expect(NOTIFICATION_TEMPLATES[t]).toBeDefined();
      expect(NOTIFICATION_TEMPLATES[t].titleKey).toMatch(/^notifications\.types\./);
      expect(NOTIFICATION_TEMPLATES[t].bodyKey).toMatch(/^notifications\.types\./);
    }
  });
});
