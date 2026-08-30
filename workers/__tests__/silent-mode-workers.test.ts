import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P51 — the silent-mode gate at the WORKERS' fire time (§4.3 + §5):
 *   - reminder fire while ON → held (PENDING WhatsAppDispatch row), no send;
 *   - re-fire → no duplicate hold (idempotent);
 *   - admin-pressed Send (adminSend) passes the gate and flips the ledger;
 *   - an AUTO lifecycle job firing while ON → re-parked to the outbox;
 *   - the home-exercise worker holds/sends the same way;
 *   - silent OFF → byte-for-byte today's behaviour (regression).
 *
 * ⚠️ Deliberate decision reversal (owner-approved, P51 §1.4): the workers
 * now consult the dispatch layer's gate — reversing "التذكير يبقى تلقائياً"
 * (P50 decision 3) and P48's reminder/dispatch separation.
 */

// Capture both workers' processors instead of talking to Redis.
const processors: Record<string, (job: { data: Record<string, unknown> }) => Promise<void>> = {};
vi.mock('bullmq', () => ({
  Worker: class {
    constructor(queue: string, fn: (job: { data: Record<string, unknown> }) => Promise<void>) {
      processors[queue] = fn;
    }
    on(): void {}
  },
  Queue: class {
    on(): void {}
  },
}));
vi.mock('@/lib/queue/client', () => ({ queueRedis: {} }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://x.test' } }));
vi.mock('@/lib/time/clinic-server', () => ({ getClinicTimeZone: vi.fn(async () => 'Asia/Amman') }));
vi.mock('@/lib/whatsapp/templates/approval', () => ({
  reminderV3Approved: vi.fn(async () => true),
  isTemplateApproved: vi.fn(async () => true),
}));

interface HeldRow {
  id: string;
  type: string;
  status: string;
  appointmentId: string | null;
  patientId: string | null;
  homeProgramItemId: string | null;
}
const state = {
  silent: false,
  appointment: null as Record<string, unknown> | null,
  homeItem: null as Record<string, unknown> | null,
  held: [] as HeldRow[],
  updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  enqueued: [] as Array<Record<string, unknown>>,
};
let seq = 0;

// REAL silent-mode module on top of this db mock — the gate logic itself
// (live read, dedupe, re-park) is under test, not mocked away.
vi.mock('@/lib/db', () => ({
  db: {
    clinicSettings: {
      findUnique: vi.fn(async () => ({ whatsappSilentMode: state.silent })),
    },
    appointment: {
      findUnique: vi.fn(async () => state.appointment),
      findMany: vi.fn(async () =>
        state.appointment
          ? [
              {
                id: (state.appointment as Record<string, unknown>).id,
                startsAt: (state.appointment as Record<string, unknown>).startsAt,
                durationMinutes: 60,
              },
            ]
          : [],
      ),
    },
    homeProgramItem: { findUnique: vi.fn(async () => state.homeItem) },
    whatsAppDispatch: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return (
          state.held.find(
            (r) =>
              (!where.type || r.type === where.type) &&
              (!where.status || r.status === where.status) &&
              (!where.appointmentId || r.appointmentId === where.appointmentId) &&
              (!where.homeProgramItemId || r.homeProgramItemId === where.homeProgramItemId),
          ) ?? null
        );
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: HeldRow = {
          id: `h${++seq}`,
          type: data.type as string,
          status: (data.status as string) ?? 'PENDING',
          appointmentId: (data.appointmentId as string) ?? null,
          patientId: (data.patientId as string) ?? null,
          homeProgramItemId: (data.homeProgramItemId as string) ?? null,
        };
        state.held.push(row);
        return { id: row.id };
      }),
      updateMany: vi.fn(
        async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          state.updates.push(args);
          return { count: 1 };
        },
      ),
      update: vi.fn(async () => ({})),
    },
  },
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
const senders = vi.hoisted(() => ({
  confirmation: vi.fn(async () => undefined),
  arrival: vi.fn(async () => undefined),
}));
vi.mock('@/lib/whatsapp/templates/sendConfirmation', () => ({
  sendAppointmentConfirmation: senders.confirmation,
}));
vi.mock('@/lib/whatsapp/templates/sendRescheduled', () => ({
  sendAppointmentRescheduled: vi.fn(async () => undefined),
}));
vi.mock('@/lib/whatsapp/templates/sendCancelled', () => ({
  sendAppointmentCancelled: vi.fn(async () => undefined),
}));
vi.mock('@/lib/whatsapp/templates/sendArrival', () => ({
  sendArrivalConfirmation: senders.arrival,
}));
vi.mock('@/lib/clinical/home-program/visibility', () => ({
  remindersActive: vi.fn(async () => true),
}));

import { startHomeReminderWorker } from '../homeReminder';
import { startReminderWorker } from '../reminder';

const REMINDERS = 'reminders';
const HOME = 'homeProgramReminders';

const patient = {
  id: 'p1',
  fullNameEn: 'Test',
  fullNameAr: 'اختبار',
  phone: '+962790000001',
  languagePref: 'AR',
  whatsappReachable: true,
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  state.silent = false;
  state.held = [];
  state.updates = [];
  state.enqueued = [];
  seq = 0;
  senders.confirmation.mockClear();
  senders.arrival.mockClear();
  state.appointment = {
    id: 'appt-1',
    status: 'SCHEDULED',
    startsAt: new Date(Date.now() + 60 * 60 * 1000),
    appointmentType: 'SESSION',
    patientId: 'p1',
    patient,
    groupPatients: [],
    therapists: [],
  };
  state.homeItem = {
    id: 'item-1',
    active: true,
    therapistNote: null,
    patient,
    exercise: { nameEn: 'Squat', nameAr: 'سكوات' },
  };
  startReminderWorker();
  startHomeReminderWorker();
});

describe('P17 reminder fire under silent mode', () => {
  it('silent ON → held REMINDER row, outbound NEVER enqueued, appointment+patient referenced', async () => {
    state.silent = true;
    await processors[REMINDERS]!({ data: { appointmentId: 'appt-1' } });
    expect(state.enqueued).toHaveLength(0);
    expect(state.held).toHaveLength(1);
    expect(state.held[0]).toMatchObject({
      type: 'REMINDER',
      status: 'PENDING',
      appointmentId: 'appt-1',
      patientId: 'p1',
    });
  });

  it('a re-fired job does not double the hold (idempotent)', async () => {
    state.silent = true;
    await processors[REMINDERS]!({ data: { appointmentId: 'appt-1' } });
    await processors[REMINDERS]!({ data: { appointmentId: 'appt-1' } });
    expect(state.held).toHaveLength(1);
  });

  it('adminSend passes the gate even while silent ON, and flips the ledger row to SENT', async () => {
    state.silent = true;
    state.held.push({
      id: 'h9',
      type: 'REMINDER',
      status: 'SCHEDULED',
      appointmentId: 'appt-1',
      patientId: 'p1',
      homeProgramItemId: null,
    });
    await processors[REMINDERS]!({ data: { appointmentId: 'appt-1', adminSend: true } });
    expect(state.enqueued).toHaveLength(1);
    expect(state.enqueued[0]).toMatchObject({ recipientPhone: '+962790000001' });
  });

  it("silent OFF → exactly today's behaviour: sends, holds nothing (regression)", async () => {
    await processors[REMINDERS]!({ data: { appointmentId: 'appt-1' } });
    expect(state.enqueued).toHaveLength(1);
    expect(state.held).toHaveLength(0);
  });
});

describe('AUTO lifecycle job firing under silent mode', () => {
  it('confirmation job while ON → re-parked to PENDING, sender NOT called', async () => {
    state.silent = true;
    await processors[REMINDERS]!({ data: { appointmentId: 'appt-1', kind: 'confirmation' } });
    expect(senders.confirmation).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          appointmentId: 'appt-1',
          type: 'BOOKING_CONFIRMATION',
          status: 'SCHEDULED',
        }),
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });

  it('confirmation job with adminSend while ON → the sender runs (human pressed Send)', async () => {
    state.silent = true;
    await processors[REMINDERS]!({
      data: { appointmentId: 'appt-1', kind: 'confirmation', adminSend: true },
    });
    expect(senders.confirmation).toHaveBeenCalledTimes(1);
  });

  it('kind=arrival (outbox Send of a held arrival) re-derives via the kiosk sender', async () => {
    state.silent = true;
    state.held.push({
      id: 'h7',
      type: 'ARRIVAL',
      status: 'SCHEDULED',
      appointmentId: 'appt-1',
      patientId: 'p1',
      homeProgramItemId: null,
    });
    await processors[REMINDERS]!({
      data: { appointmentId: 'appt-1', kind: 'arrival', adminSend: true },
    });
    // P59 — an admin-pressed Send forces past a stale whatsappReachable flag.
    expect(senders.arrival).toHaveBeenCalledWith({
      patientId: 'p1',
      appointmentIds: ['appt-1'],
      force: true,
    });
  });
});

describe('home-exercise reminder under silent mode', () => {
  it('silent ON → held HOME_PROGRAM row (patient + item, no appointment), no outbound', async () => {
    state.silent = true;
    await processors[HOME]!({
      data: { itemId: 'item-1' },
      name: 'homeExerciseReminder',
    } as never);
    expect(state.enqueued).toHaveLength(0);
    expect(state.held[0]).toMatchObject({
      type: 'HOME_PROGRAM',
      status: 'PENDING',
      appointmentId: null,
      patientId: 'p1',
      homeProgramItemId: 'item-1',
    });
  });

  it('adminSend passes the gate: sends + flips the SCHEDULED row to SENT', async () => {
    state.silent = true;
    await processors[HOME]!({
      data: { itemId: 'item-1', adminSend: true },
      name: 'homeExerciseReminder',
    } as never);
    expect(state.enqueued).toHaveLength(1);
    expect(state.updates).toContainEqual(
      expect.objectContaining({
        where: expect.objectContaining({ homeProgramItemId: 'item-1', type: 'HOME_PROGRAM' }),
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
  });

  it('silent OFF → sends normally, holds nothing (regression)', async () => {
    await processors[HOME]!({
      data: { itemId: 'item-1' },
      name: 'homeExerciseReminder',
    } as never);
    expect(state.enqueued).toHaveLength(1);
    expect(state.held).toHaveLength(0);
  });
});
