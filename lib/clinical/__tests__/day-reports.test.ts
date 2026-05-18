import { PlanStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  const state = {
    dayReports: [] as Array<{
      id: string;
      therapistId: string;
      date: Date;
      patientEntries: unknown;
    }>,
    plans: [
      { patientId: 'patient-1', doctorId: 'doctor-a', status: PlanStatus.ACTIVE },
      { patientId: 'patient-2', doctorId: 'doctor-b', status: PlanStatus.ACTIVE },
      { patientId: 'patient-3', doctorId: 'doctor-a', status: PlanStatus.ACTIVE }, // same doctor as patient-1
    ] as Array<{ patientId: string; doctorId: string; status: PlanStatus }>,
    users: [
      { id: 'therapist-1', fullNameEn: 'T One' },
      { id: 'doctor-a', fullNameEn: 'Doctor A' },
      { id: 'doctor-b', fullNameEn: 'Doctor B' },
    ] as Array<{ id: string; fullNameEn: string }>,
    notifications: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
    counter: 0,
  };
  return {
    __state: state,
    db: {
      dayReport: {
        upsert: vi.fn(
          async ({
            where,
            create,
          }: {
            where: { therapistId_date: { therapistId: string; date: Date } };
            create: Record<string, unknown>;
          }) => {
            const existing = state.dayReports.find(
              (r) =>
                r.therapistId === where.therapistId_date.therapistId &&
                r.date.getTime() === where.therapistId_date.date.getTime(),
            );
            if (existing) {
              existing.patientEntries = create.patientEntries;
              return { id: existing.id };
            }
            state.counter += 1;
            const id = `dr-${state.counter}`;
            state.dayReports.push({
              id,
              therapistId: create.therapistId as string,
              date: create.date as Date,
              patientEntries: create.patientEntries,
            });
            return { id };
          },
        ),
      },
      treatmentPlan: {
        findMany: vi.fn(
          async ({ where }: { where: { patientId: { in: string[] }; status: PlanStatus } }) =>
            state.plans.filter(
              (p) => where.patientId.in.includes(p.patientId) && p.status === where.status,
            ),
        ),
      },
      user: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.users.find((u) => u.id === where.id) ?? null,
        ),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.auditLogs.push(data);
          return data;
        }),
      },
      notification: {
        create: vi.fn(
          async ({ data, select }: { data: Record<string, unknown>; select?: { id: true } }) => {
            state.counter += 1;
            const id = `notif-${state.counter}`;
            state.notifications.push({ id, ...data });
            return select?.id ? { id } : { id, ...data };
          },
        ),
      },
    },
    toLocalizedError: (err: unknown) => ({
      code: 'INTERNAL',
      message_en: err instanceof Error ? err.message : String(err),
      message_ar: 'خطأ.',
    }),
  };
});

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'therapist-1', role: 'THERAPIST' } })),
}));

import * as dbModule from '@/lib/db';
import { submitDayReport } from '../day-reports/services';

const state = (
  dbModule as unknown as {
    __state: {
      dayReports: Array<{ id: string; therapistId: string; date: Date; patientEntries: unknown }>;
      notifications: Array<Record<string, unknown>>;
      counter: number;
    };
  }
).__state;

beforeEach(() => {
  state.dayReports.length = 0;
  state.notifications.length = 0;
  state.counter = 0;
});

describe('submitDayReport', () => {
  it('upserts on (therapistId, date) — second submission overwrites', async () => {
    const r1 = await submitDayReport(
      {
        date: '2026-05-19',
        overallSummary: 'first version',
        patientEntries: [{ patientId: 'patient-1', appointmentId: 'a1', note: 'a' }],
      },
      { therapistId: 'therapist-1' },
    );
    const r2 = await submitDayReport(
      {
        date: '2026-05-19',
        overallSummary: 'updated',
        patientEntries: [{ patientId: 'patient-1', appointmentId: 'a1', note: 'updated' }],
      },
      { therapistId: 'therapist-1' },
    );
    expect(r1.reportId).toBe(r2.reportId);
    expect(state.dayReports).toHaveLength(1);
  });

  it('notifies each unique responsible doctor exactly once', async () => {
    // patient-1 and patient-3 share doctor-a; patient-2 has doctor-b.
    // Expect 2 notifications (one per unique doctor), not 3.
    await submitDayReport(
      {
        date: '2026-05-19',
        overallSummary: 'mixed entries',
        patientEntries: [
          { patientId: 'patient-1', appointmentId: 'a1', note: '...' },
          { patientId: 'patient-2', appointmentId: 'a2', note: '...' },
          { patientId: 'patient-3', appointmentId: 'a3', note: '...' },
        ],
      },
      { therapistId: 'therapist-1' },
    );
    const recipients = state.notifications.map((n) => n.recipientId).sort();
    expect(recipients).toEqual(['doctor-a', 'doctor-b']);
    for (const n of state.notifications) {
      expect(n.type).toBe('DAY_REPORT_SUBMITTED');
    }
  });

  it('handles patients with no active plan without throwing', async () => {
    await submitDayReport(
      {
        date: '2026-05-19',
        overallSummary: 'walk-in only',
        patientEntries: [{ patientId: 'patient-orphan', appointmentId: 'a99', note: 'walk-in' }],
      },
      { therapistId: 'therapist-1' },
    );
    expect(state.dayReports).toHaveLength(1);
    expect(state.notifications).toHaveLength(0);
  });
});
