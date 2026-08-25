import { describe, expect, it, vi } from 'vitest';

/**
 * P50 — a patient may have no phone: the reminder worker must skip cleanly
 * and log, never enqueue an outbound job to nowhere (§2.2, mirroring the
 * P29 patient-less EVENT skip).
 */

// Capture the processor the worker registers instead of talking to Redis.
let processor: ((job: { data: { appointmentId: string } }) => Promise<void>) | null = null;
vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_queue: string, fn: typeof processor) {
      processor = fn;
    }
    on(): void {}
  },
  // lib/queue/queues.ts instantiates Queue at import time.
  Queue: class {
    on(): void {}
  },
}));

vi.mock('@/lib/queue/client', () => ({ queueRedis: {} }));

// P51 — these tests pin the silent-OFF behaviour; the gate itself is
// covered in silent-mode-workers.test.ts.
vi.mock('@/lib/whatsapp/silent-mode', () => ({
  isSilentModeOn: vi.fn(async () => false),
  holdForOutbox: vi.fn(async () => 'held-x'),
  reparkScheduled: vi.fn(async () => undefined),
}));

const state = {
  appointment: null as Record<string, unknown> | null,
  enqueued: [] as Array<Record<string, unknown>>,
};

vi.mock('@/lib/db', () => ({
  db: {
    appointment: {
      findUnique: vi.fn(async () => state.appointment),
      // P53 — the worker gathers the patient's same-day appointments.
      findMany: vi.fn(async () =>
        state.appointment
          ? [
              {
                id: state.appointment.id,
                startsAt: state.appointment.startsAt,
                durationMinutes: 60,
              },
            ]
          : [],
      ),
    },
  },
}));
vi.mock('@/lib/time/clinic-server', () => ({
  getClinicTimeZone: vi.fn(async () => 'Asia/Amman'),
}));
vi.mock('@/lib/whatsapp/templates/approval', () => ({
  reminderV3Approved: vi.fn(async () => true),
  isTemplateApproved: vi.fn(async () => true),
}));

vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({
  enqueueWhatsappOutbound: vi.fn(async (job: Record<string, unknown>) => {
    state.enqueued.push(job);
    return 'enq-1';
  }),
}));

vi.mock('@/lib/whatsapp/templates/variables', () => ({
  resolveTemplateShape: vi.fn(async () => ['patientName', 'date', 'time']),
  appointmentVarContext: vi.fn(async () => ({})),
  buildParamsFromShape: vi.fn(() => []),
}));

const lifecycleCalls = { confirmation: [] as string[], reschedule: [] as string[] };
vi.mock('@/lib/whatsapp/templates/sendConfirmation', () => ({
  sendAppointmentConfirmation: vi.fn(async ({ appointmentId }: { appointmentId: string }) => {
    lifecycleCalls.confirmation.push(appointmentId);
  }),
}));
vi.mock('@/lib/whatsapp/templates/sendRescheduled', () => ({
  sendAppointmentRescheduled: vi.fn(async ({ appointmentId }: { appointmentId: string }) => {
    lifecycleCalls.reschedule.push(appointmentId);
  }),
}));

import { startReminderWorker } from '../reminder';

function appointment(patient: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'appt-1',
    status: 'SCHEDULED',
    startsAt: new Date(Date.now() + 60 * 60 * 1000),
    appointmentType: 'SESSION',
    patient,
    groupPatients: [],
    therapists: [],
  };
}

describe('reminder worker — phone-less patient (P50)', () => {
  it('skips with a log line and enqueues NOTHING', async () => {
    startReminderWorker();
    expect(processor).not.toBeNull();
    state.enqueued.length = 0;
    state.appointment = appointment({
      id: 'p-nophone',
      fullNameEn: '',
      fullNameAr: 'سارة',
      phone: null,
      languagePref: 'AR',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await processor!({ data: { appointmentId: 'appt-1' } });
    expect(state.enqueued).toHaveLength(0);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('has no phone'))).toBe(true);
    warn.mockRestore();
  });

  it('P53: kind=confirmation dispatches the confirmation sender, no reminder logic runs', async () => {
    startReminderWorker();
    state.enqueued.length = 0;
    lifecycleCalls.confirmation.length = 0;
    await processor!({ data: { appointmentId: 'appt-9', kind: 'confirmation' } } as never);
    expect(lifecycleCalls.confirmation).toEqual(['appt-9']);
    expect(state.enqueued).toHaveLength(0); // no reminder template enqueued
  });

  it('P53: kind=reschedule dispatches the reschedule sender', async () => {
    startReminderWorker();
    lifecycleCalls.reschedule.length = 0;
    await processor!({ data: { appointmentId: 'appt-8', kind: 'reschedule' } } as never);
    expect(lifecycleCalls.reschedule).toEqual(['appt-8']);
  });

  it('still sends for a patient WITH a phone (guard is not over-broad)', async () => {
    startReminderWorker();
    state.enqueued.length = 0;
    state.appointment = appointment({
      id: 'p-phone',
      fullNameEn: '',
      fullNameAr: 'قيس',
      phone: '+962790000001',
      languagePref: 'AR',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await processor!({ data: { appointmentId: 'appt-1' } });
    expect(state.enqueued).toHaveLength(1);
    expect(state.enqueued[0]).toMatchObject({ recipientPhone: '+962790000001' });
    warn.mockRestore();
  });
});
