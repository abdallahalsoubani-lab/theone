import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  const state = {
    // One row per (therapist → patient) care-team link, as the scan now reads.
    members: [] as Array<{
      clinicianId: string;
      patientId: string;
      patient: { user: { fullNameEn: string; deletedAt: Date | null } };
    }>,
    items: [] as Array<{
      id: string;
      patientId: string;
      active: boolean;
      daysOfWeek: number[];
      createdAt: Date;
    }>,
    completions: [] as Array<{ itemId: string; scheduledDate: Date }>,
    notifications: [] as Array<{
      recipientId: string;
      type: string;
      relatedEntityId: string | null;
      relatedEntityType: string | null;
      params: Record<string, unknown>;
      createdAt: Date;
    }>,
  };
  return {
    __state: state,
    db: {
      careTeamMember: {
        findMany: vi.fn(async () => state.members),
      },
      homeProgramItem: {
        findMany: vi.fn(async ({ where }: { where: { patientId: string; active: boolean } }) =>
          state.items.filter((i) => i.patientId === where.patientId && i.active === where.active),
        ),
      },
      homeProgramCompletion: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              item: { patientId: string; active: boolean };
              scheduledDate: { gte: Date; lte: Date };
            };
          }) =>
            state.completions.filter((c) => {
              const item = state.items.find((i) => i.id === c.itemId);
              if (!item) return false;
              if (item.patientId !== where.item.patientId) return false;
              if (item.active !== where.item.active) return false;
              return (
                c.scheduledDate.getTime() >= where.scheduledDate.gte.getTime() &&
                c.scheduledDate.getTime() <= where.scheduledDate.lte.getTime()
              );
            }),
        ),
      },
      notification: {
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: {
              recipientId: string;
              type: string;
              relatedEntityType?: string;
              relatedEntityId?: string;
              createdAt?: { gte: Date };
            };
          }) =>
            state.notifications.find(
              (n) =>
                n.recipientId === where.recipientId &&
                n.type === where.type &&
                (!where.relatedEntityType || n.relatedEntityType === where.relatedEntityType) &&
                (!where.relatedEntityId || n.relatedEntityId === where.relatedEntityId) &&
                (!where.createdAt || n.createdAt.getTime() >= where.createdAt.gte.getTime()),
            ) ?? null,
        ),
      },
    },
  };
});

// Capture every createNotification call without writing audit rows.
const notificationCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/notifications/actions', () => ({
  createNotification: vi.fn(async (args: Record<string, unknown>) => {
    notificationCalls.push(args);
    return { id: `notif-${notificationCalls.length}` };
  }),
}));

import * as dbModule from '@/lib/db';
import { runLowComplianceCheck } from '../checkLowCompliance';

const state = (
  dbModule as unknown as {
    __state: {
      members: Array<{
        clinicianId: string;
        patientId: string;
        patient: { user: { fullNameEn: string; deletedAt: Date | null } };
      }>;
      items: Array<{
        id: string;
        patientId: string;
        active: boolean;
        daysOfWeek: number[];
        createdAt: Date;
      }>;
      completions: Array<{ itemId: string; scheduledDate: Date }>;
      notifications: Array<{
        recipientId: string;
        type: string;
        relatedEntityId: string | null;
        relatedEntityType: string | null;
        params: Record<string, unknown>;
        createdAt: Date;
      }>;
    };
  }
).__state;

const FIXED_NOW = new Date('2026-05-20T18:00:00Z');
function daysAgo(n: number): Date {
  const d = new Date('2026-05-20T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

beforeEach(() => {
  state.members.length = 0;
  state.items.length = 0;
  state.completions.length = 0;
  state.notifications.length = 0;
  notificationCalls.length = 0;
});

function seedLowCompliancePatient() {
  state.members.push({
    clinicianId: 'therapist-1',
    patientId: 'patient-low',
    patient: { user: { fullNameEn: 'Patient Low', deletedAt: null } },
  });
  // Daily item with no completions → rate 0.
  state.items.push({
    id: 'i-low',
    patientId: 'patient-low',
    active: true,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    createdAt: daysAgo(30),
  });
}

describe('runLowComplianceCheck', () => {
  it('emits a notification when 7-day rate < threshold', async () => {
    seedLowCompliancePatient();
    const r = await runLowComplianceCheck({ now: FIXED_NOW });
    expect(r.patientsChecked).toBe(1);
    expect(r.notificationsCreated).toBe(1);
    expect(notificationCalls[0]).toMatchObject({
      recipientId: 'therapist-1',
      type: 'LOW_COMPLIANCE',
      relatedEntityType: 'User',
      relatedEntityId: 'patient-low',
    });
  });

  it('skips when 7-day rate is at the threshold or above', async () => {
    state.members.push({
      clinicianId: 'therapist-1',
      patientId: 'patient-ok',
      patient: { user: { fullNameEn: 'Patient OK', deletedAt: null } },
    });
    state.items.push({
      id: 'i-ok',
      patientId: 'patient-ok',
      active: true,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      createdAt: daysAgo(30),
    });
    // 6 of 7 completions = 86%, above 50% threshold.
    for (let i = 0; i < 6; i++) {
      state.completions.push({ itemId: 'i-ok', scheduledDate: daysAgo(i) });
    }
    const r = await runLowComplianceCheck({ now: FIXED_NOW });
    expect(r.notificationsCreated).toBe(0);
  });

  it('skips when rate is null (no active items)', async () => {
    state.members.push({
      clinicianId: 'therapist-1',
      patientId: 'patient-no-program',
      patient: { user: { fullNameEn: 'No program', deletedAt: null } },
    });
    const r = await runLowComplianceCheck({ now: FIXED_NOW });
    expect(r.notificationsCreated).toBe(0);
  });

  it('respects the 3-day cooldown — does not re-notify within the window', async () => {
    seedLowCompliancePatient();
    // Prior LOW_COMPLIANCE notification created yesterday.
    state.notifications.push({
      recipientId: 'therapist-1',
      type: 'LOW_COMPLIANCE',
      relatedEntityType: 'User',
      relatedEntityId: 'patient-low',
      params: {},
      createdAt: daysAgo(1),
    });
    const r = await runLowComplianceCheck({ now: FIXED_NOW });
    expect(r.notificationsCreated).toBe(0);
    expect(r.notificationsSkippedByCooldown).toBe(1);
  });

  it('re-notifies after the cooldown window elapses', async () => {
    seedLowCompliancePatient();
    // Prior notification 5 days ago — well past the 3-day cooldown.
    state.notifications.push({
      recipientId: 'therapist-1',
      type: 'LOW_COMPLIANCE',
      relatedEntityType: 'User',
      relatedEntityId: 'patient-low',
      params: {},
      createdAt: daysAgo(5),
    });
    const r = await runLowComplianceCheck({ now: FIXED_NOW });
    expect(r.notificationsCreated).toBe(1);
  });

  it('skips soft-deleted patients', async () => {
    state.members.push({
      clinicianId: 'therapist-1',
      patientId: 'patient-deleted',
      patient: { user: { fullNameEn: 'Deleted', deletedAt: new Date() } },
    });
    state.items.push({
      id: 'i-d',
      patientId: 'patient-deleted',
      active: true,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      createdAt: daysAgo(30),
    });
    const r = await runLowComplianceCheck({ now: FIXED_NOW });
    expect(r.patientsChecked).toBe(0);
  });

  it('skips patients with no therapist on the care team', async () => {
    // A patient with no THERAPIST care-team link produces no membership row,
    // so the scan never sees them.
    const r = await runLowComplianceCheck({ now: FIXED_NOW });
    expect(r.patientsChecked).toBe(0);
    expect(r.notificationsCreated).toBe(0);
  });
});
