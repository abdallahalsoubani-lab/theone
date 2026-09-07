import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P60 decisions 5 + 6 — closing the automatic path when the same type went
 * out by hand: open PENDING/SCHEDULED rows for (appointment, type) become
 * SUPERSEDED_BY_MANUAL, that type's queued job is removed — and the P17
 * `appointment-reminder-{id}` job is NEVER touched.
 */
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_cfg: unknown, fn: unknown) => fn,
}));

const updates = vi.hoisted(() => [] as Array<{ where: unknown; data: unknown }>);
vi.mock('@/lib/db', () => ({
  db: {
    whatsAppDispatch: {
      updateMany: vi.fn(async (args: { where: unknown; data: unknown }) => {
        updates.push(args);
        return { count: 2 };
      }),
    },
    clinicSettings: { findUnique: vi.fn(async () => ({})) },
  },
}));

const removed = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/queue/queues', () => ({
  reminderQueue: {
    add: vi.fn(),
    remove: vi.fn(async (id: string) => {
      removed.push(id);
    }),
    getJob: vi.fn(async () => null),
  },
  homeProgramQueue: { add: vi.fn(), remove: vi.fn() },
}));

import { closeOpenDispatchForManualSend } from '../service';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  updates.length = 0;
  removed.length = 0;
});

describe('closeOpenDispatchForManualSend', () => {
  it('BOOKING_CONFIRMATION: closes open rows with the distinguishable status + removes confirm-{id}', async () => {
    const r = await closeOpenDispatchForManualSend({
      appointmentId: 'a1',
      type: 'BOOKING_CONFIRMATION',
    });
    expect(r).toEqual({ closed: 2 });
    expect(updates[0]).toEqual({
      where: {
        appointmentId: 'a1',
        type: 'BOOKING_CONFIRMATION',
        status: { in: ['PENDING', 'SCHEDULED'] },
      },
      data: { status: 'SUPERSEDED_BY_MANUAL', dispatchReason: null },
    });
    expect(removed).toEqual(['confirm-a1']);
  });

  it('RESCHEDULE / CANCELLATION remove their own lifecycle job only', async () => {
    await closeOpenDispatchForManualSend({ appointmentId: 'a1', type: 'RESCHEDULE' });
    await closeOpenDispatchForManualSend({ appointmentId: 'a1', type: 'CANCELLATION' });
    expect(removed).toEqual(['resched-a1', 'cancelmsg-a1']);
  });

  it('REMINDER: removes the outbox-send job only — the automatic appointment-reminder job is untouched (decision 6)', async () => {
    await closeOpenDispatchForManualSend({ appointmentId: 'a1', type: 'REMINDER' });
    expect(removed).toEqual(['outbox-reminder-a1']);
    expect(removed).not.toContain('appointment-reminder-a1');
  });

  it('ARRIVAL: removes the outbox arrival job only', async () => {
    await closeOpenDispatchForManualSend({ appointmentId: 'a1', type: 'ARRIVAL' });
    expect(removed).toEqual(['outbox-arrival-a1']);
  });
});
