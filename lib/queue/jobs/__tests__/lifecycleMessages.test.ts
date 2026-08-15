import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * P53 §4 — deferred, coalescing lifecycle messages: the clamp math, the
 * replace-on-edit (remove both ids, add the right kind), and the cancel
 * removal — all riding the P17 reminder queue (no parallel mechanism).
 */

const queueState = {
  removed: [] as string[],
  added: [] as Array<{ jobId?: string; delay?: number; data: Record<string, unknown> }>,
  pendingJobs: new Map<string, { delay: number }>(),
};

vi.mock('../../queues', () => ({
  reminderQueue: {
    add: vi.fn(
      async (
        _name: string,
        data: Record<string, unknown>,
        opts: { jobId?: string; delay?: number },
      ) => {
        queueState.added.push({ jobId: opts.jobId, delay: opts.delay, data });
        return { id: opts.jobId };
      },
    ),
    remove: vi.fn(async (jobId: string) => {
      queueState.removed.push(jobId);
      queueState.pendingJobs.delete(jobId);
    }),
    getJob: vi.fn(async (jobId: string) => queueState.pendingJobs.get(jobId) ?? null),
  },
}));

import {
  cancelLifecycleMessages,
  computeLifecycleDelayMs,
  lifecycleJobId,
  scheduleLifecycleMessage,
} from '../appointmentReminder';

function reset(): void {
  queueState.removed.length = 0;
  queueState.added.length = 0;
  queueState.pendingJobs.clear();
}

const MIN = 60 * 1000;

describe('computeLifecycleDelayMs — the near-appointment clamp (§1.4)', () => {
  const now = new Date('2026-07-27T10:00:00Z');

  it('X=120 with a far appointment → exactly 120min', () => {
    expect(
      computeLifecycleDelayMs({
        now,
        startsAt: new Date('2026-07-28T10:00:00Z'),
        delayMinutes: 120,
      }),
    ).toBe(120 * MIN);
  });

  it('appointment in 90min with X=120 → clamps to start−15min (75min)', () => {
    expect(
      computeLifecycleDelayMs({
        now,
        startsAt: new Date('2026-07-27T11:30:00Z'),
        delayMinutes: 120,
      }),
    ).toBe(75 * MIN);
  });

  it('appointment in 10min → effectively immediate (never negative)', () => {
    expect(
      computeLifecycleDelayMs({
        now,
        startsAt: new Date('2026-07-27T10:10:00Z'),
        delayMinutes: 120,
      }),
    ).toBe(0);
  });

  it('past-start edge → null (skip + log, mirroring P17 late-booking)', () => {
    expect(
      computeLifecycleDelayMs({
        now,
        startsAt: new Date('2026-07-27T09:59:00Z'),
        delayMinutes: 120,
      }),
    ).toBeNull();
  });

  it('X=0 → 0 delay — identical to today (regression)', () => {
    expect(
      computeLifecycleDelayMs({
        now,
        startsAt: new Date('2026-07-28T10:00:00Z'),
        delayMinutes: 0,
      }),
    ).toBe(0);
  });
});

describe('scheduleLifecycleMessage — coalescing (§1.3)', () => {
  beforeEach(reset);

  const future = () => new Date(Date.now() + 24 * 60 * MIN);

  it('books a confirmation job with the deterministic id and the delay', async () => {
    const id = await scheduleLifecycleMessage({
      appointmentId: 'appt-1',
      startsAt: future(),
      kind: 'confirmation',
      delayMinutes: 120,
    });
    expect(id).toBe('confirm-appt-1');
    expect(queueState.added).toHaveLength(1);
    expect(queueState.added[0]).toMatchObject({
      jobId: 'confirm-appt-1',
      data: { appointmentId: 'appt-1', kind: 'confirmation' },
    });
    expect(queueState.added[0]!.delay).toBeGreaterThan(119 * MIN);
    // The replace step removed BOTH possible pending kinds first.
    expect(queueState.removed).toEqual(['confirm-appt-1', 'resched-appt-1', 'cancelmsg-appt-1']);
  });

  it('an edit during the wait REPLACES the pending job and restarts the timer', async () => {
    await scheduleLifecycleMessage({
      appointmentId: 'appt-1',
      startsAt: future(),
      kind: 'confirmation',
      delayMinutes: 120,
    });
    reset();
    // …30min later the appointment is edited; confirmation never sent →
    // a fresh CONFIRMATION job (same id, new timer).
    await scheduleLifecycleMessage({
      appointmentId: 'appt-1',
      startsAt: future(),
      kind: 'confirmation',
      delayMinutes: 120,
    });
    expect(queueState.removed).toContain('confirm-appt-1');
    expect(queueState.added[0]!.jobId).toBe('confirm-appt-1');
    expect(queueState.added[0]!.delay).toBeGreaterThan(119 * MIN);
  });

  it('after the confirmation was SENT, an edit queues a RESCHEDULE job instead', async () => {
    await scheduleLifecycleMessage({
      appointmentId: 'appt-1',
      startsAt: future(),
      kind: 'reschedule',
      delayMinutes: 60,
    });
    expect(queueState.added[0]).toMatchObject({
      jobId: 'resched-appt-1',
      data: { kind: 'reschedule' },
    });
  });

  it('past-start → nothing enqueued, returns null', async () => {
    const id = await scheduleLifecycleMessage({
      appointmentId: 'appt-x',
      startsAt: new Date(Date.now() - MIN),
      kind: 'confirmation',
      delayMinutes: 120,
    });
    expect(id).toBeNull();
    expect(queueState.added).toHaveLength(0);
  });

  it('X=0 → a 0-delay job (identical to current immediate behavior)', async () => {
    await scheduleLifecycleMessage({
      appointmentId: 'appt-1',
      startsAt: future(),
      kind: 'confirmation',
      delayMinutes: 0,
    });
    expect(queueState.added[0]!.delay).toBe(0);
  });
});

describe('cancelLifecycleMessages — cancel during the wait (§1.3)', () => {
  beforeEach(reset);

  it('removes BOTH pending kinds and reports whether a confirmation was pending', async () => {
    queueState.pendingJobs.set('confirm-appt-1', { delay: 100 });
    const r = await cancelLifecycleMessages('appt-1');
    expect(r.confirmWasPending).toBe(true);
    expect(queueState.removed).toEqual(['confirm-appt-1', 'resched-appt-1', 'cancelmsg-appt-1']);
  });

  it('reports confirmWasPending=false when nothing was queued', async () => {
    const r = await cancelLifecycleMessages('appt-2');
    expect(r.confirmWasPending).toBe(false);
  });
});

describe('job ids', () => {
  it('deterministic, dash-separated (BullMQ 5 forbids colons)', () => {
    expect(lifecycleJobId('confirmation', 'a1')).toBe('confirm-a1');
    expect(lifecycleJobId('reschedule', 'a1')).toBe('resched-a1');
    expect(lifecycleJobId('confirmation', 'a1')).not.toContain(':');
  });
});

describe('cancellation joined the dispatch family (P48 — updates the P53 guard)', () => {
  it('services no longer enqueue the cancelled template inline — everything rides the funnel', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'lib/appointments/services.ts'), 'utf8');
    // The P53-era invariant ("cancellation is always an inline immediate
    // enqueue") was consciously replaced in P48 by per-type dispatch
    // control: no inline template enqueue remains in the services; the
    // sendCancelled template module + the dispatch funnel own it.
    expect(src).not.toContain("templateName: 'appointment_cancelled_v2'");
    expect(src.split('recordDispatchEvent(').length - 1).toBeGreaterThanOrEqual(5);
  });

  it('the cancellation kind has a deterministic job id and skips the pre-start clamp', () => {
    expect(lifecycleJobId('cancellation', 'a1')).toBe('cancelmsg-a1');
    // A cancellation may be ABOUT a past slot — the delay is honored as-is.
    expect(
      computeLifecycleDelayMs({
        now: new Date('2026-08-15T12:00:00Z'),
        startsAt: new Date('2026-08-15T09:00:00Z'), // already started
        delayMinutes: 30,
        kind: 'cancellation',
      }),
    ).toBe(30 * 60 * 1000);
  });
});
