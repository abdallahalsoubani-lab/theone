import { beforeEach, describe, expect, it, vi } from 'vitest';

const added: Array<{ name: string; data: unknown; opts: { delay: number; jobId: string } }> = [];
const removed: string[] = [];

vi.mock('../../queues', () => ({
  reminderQueue: {
    add: vi.fn(async (name: string, data: unknown, opts: { delay: number; jobId: string }) => {
      added.push({ name, data, opts });
      return { id: opts.jobId };
    }),
    remove: vi.fn(async (jobId: string) => {
      removed.push(jobId);
    }),
  },
}));

import {
  cancelAppointmentReminder,
  enqueueAppointmentReminder,
  reminderJobId,
} from '../appointmentReminder';
import { type ReminderConfig } from '@/lib/appointments/reminderWindow';

const CONFIG: ReminderConfig = {
  offsetMinutes: 1440,
  windowStartMinutes: 480,
  windowEndMinutes: 1080,
  timeZone: 'Asia/Amman',
};

beforeEach(() => {
  added.length = 0;
  removed.length = 0;
  vi.useRealTimers();
});

describe('enqueueAppointmentReminder', () => {
  it('schedules a job (deterministic id) for a future windowed fire time', async () => {
    // Appointment far in the future → a positive delay job is added.
    const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days out
    const id = await enqueueAppointmentReminder({ appointmentId: 'a1', startsAt, config: CONFIG });
    expect(id).toBe(reminderJobId('a1'));
    expect(added).toHaveLength(1);
    expect(added[0]!.opts.jobId).toBe('appointment-reminder-a1');
    expect(added[0]!.opts.delay).toBeGreaterThan(0);
    // Idempotency: removes any prior job before adding.
    expect(removed).toContain('appointment-reminder-a1');
  });

  it('skips (no job) when no reminder can fit before the appointment starts', async () => {
    // Appointment in 1 minute, now after the window → cannot fit → null → no add.
    const startsAt = new Date(Date.now() + 60 * 1000);
    const id = await enqueueAppointmentReminder({
      appointmentId: 'a2',
      startsAt,
      // Window far in the past relative to "now" so computeReminderFireAt can't place it.
      config: { ...CONFIG, windowStartMinutes: 0, windowEndMinutes: 0 },
    });
    expect(id).toBeNull();
    expect(added).toHaveLength(0);
  });
});

describe('cancelAppointmentReminder', () => {
  it('removes the deterministic job', async () => {
    await cancelAppointmentReminder('a3');
    expect(removed).toContain('appointment-reminder-a3');
  });
});
