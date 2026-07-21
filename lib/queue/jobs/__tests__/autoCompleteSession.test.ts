import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * July change request #4 — the auto-complete job fires at startsAt + duration
 * (zero grace). Enqueue is idempotent (remove-before-add) and cancel removes
 * by the deterministic job id, mirroring the appointment reminder job so
 * reschedule/cancel reuse the same lifecycle.
 */

const add = vi.fn(
  async (_name: string, _data: unknown, _opts: { delay: number; jobId: string }) => ({
    id: 'job-1',
  }),
);
const remove = vi.fn(async (_id: string) => undefined);

vi.mock('@/lib/queue/queues', () => ({
  sessionMaintenanceQueue: {
    add: (name: string, data: unknown, opts: { delay: number; jobId: string }) =>
      add(name, data, opts),
    remove: (id: string) => remove(id),
  },
}));

import {
  autoCompleteJobId,
  cancelAutoCompleteSession,
  enqueueAutoCompleteSession,
} from '../autoCompleteSession';

describe('enqueueAutoCompleteSession', () => {
  beforeEach(() => {
    add.mockClear();
    remove.mockClear();
  });

  it('schedules the job at startsAt + durationMinutes with the deterministic id', async () => {
    const startsAt = new Date(Date.now() + 60 * 60_000); // 1h out
    await enqueueAutoCompleteSession({ appointmentId: 'a1', startsAt, durationMinutes: 30 });

    // remove-before-add idempotency
    expect(remove).toHaveBeenCalledWith(autoCompleteJobId('a1'));

    const [name, data, opts] = add.mock.calls[0]!;
    expect(name).toBe('autoCompleteSession');
    expect(data).toEqual({ appointmentId: 'a1' });
    expect(opts.jobId).toBe(autoCompleteJobId('a1'));
    // fireAt = startsAt + 30m → delay ≈ 90m from now.
    const expected = startsAt.getTime() + 30 * 60_000 - Date.now();
    expect(Math.abs(opts.delay - expected)).toBeLessThan(5_000);
  });

  it('clamps a past end time to delay 0', async () => {
    const startsAt = new Date(Date.now() - 60 * 60_000); // ended an hour ago
    await enqueueAutoCompleteSession({ appointmentId: 'a2', startsAt, durationMinutes: 30 });
    const [, , opts] = add.mock.calls[0]!;
    expect(opts.delay).toBe(0);
  });
});

describe('cancelAutoCompleteSession', () => {
  it('removes the job by its deterministic id', async () => {
    remove.mockClear();
    await cancelAutoCompleteSession('a3');
    expect(remove).toHaveBeenCalledWith(autoCompleteJobId('a3'));
  });
});
