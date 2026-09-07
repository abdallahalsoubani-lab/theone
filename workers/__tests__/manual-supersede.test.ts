import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P60 decision 5 — a lifecycle job whose ledger row was closed by a manual
 * panel send (SUPERSEDED_BY_MANUAL) must no-op at fire time even if the
 * queue removal raced: the patient is never double-messaged.
 */
let processor: ((job: { data: Record<string, unknown> }) => Promise<void>) | null = null;
vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_q: string, fn: typeof processor) {
      processor = fn;
    }
    on(): void {}
  },
  Queue: class {
    on(): void {}
  },
}));
vi.mock('@/lib/queue/client', () => ({ queueRedis: {} }));
vi.mock('@/lib/whatsapp/silent-mode', () => ({
  isSilentModeOn: vi.fn(async () => false),
  holdForOutbox: vi.fn(async () => 'held'),
  reparkScheduled: vi.fn(async () => undefined),
}));

const state = vi.hoisted(() => ({
  ledgerStatus: 'SCHEDULED' as string,
  outcomes: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/db', () => ({
  db: {
    whatsAppDispatch: {
      findFirst: vi.fn(async ({ where }: { where: { status?: string } }) =>
        // The worker's guard asks for the latest row of (appointment, type)
        // with no status filter; markDispatchOutcome asks for SCHEDULED.
        where.status === undefined
          ? { status: state.ledgerStatus }
          : state.ledgerStatus === 'SCHEDULED'
            ? { id: 'd1' }
            : null,
      ),
      update: vi.fn(async (args: Record<string, unknown>) => {
        state.outcomes.push(args);
        return {};
      }),
    },
    appointment: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  },
}));

const senders = vi.hoisted(() => ({
  confirmation: vi.fn(async () => null),
  reschedule: vi.fn(async () => []),
  cancellation: vi.fn(async () => null),
}));
vi.mock('@/lib/whatsapp/templates/sendConfirmation', () => ({
  sendAppointmentConfirmation: senders.confirmation,
}));
vi.mock('@/lib/whatsapp/templates/sendRescheduled', () => ({
  sendAppointmentRescheduled: senders.reschedule,
}));
vi.mock('@/lib/whatsapp/templates/sendCancelled', () => ({
  sendAppointmentCancelled: senders.cancellation,
}));
vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({
  enqueueWhatsappOutbound: vi.fn(async () => 'enq'),
}));

import { startReminderWorker } from '../reminder';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  state.ledgerStatus = 'SCHEDULED';
  state.outcomes = [];
  senders.confirmation.mockClear();
  senders.reschedule.mockClear();
  senders.cancellation.mockClear();
  startReminderWorker();
});

describe('reminder worker — lifecycle job vs. a manual panel send', () => {
  it('ledger row SUPERSEDED_BY_MANUAL → the confirmation job no-ops (no send, no outcome flip)', async () => {
    state.ledgerStatus = 'SUPERSEDED_BY_MANUAL';
    await processor!({ data: { appointmentId: 'a1', kind: 'confirmation' } });
    expect(senders.confirmation).not.toHaveBeenCalled();
    expect(state.outcomes).toHaveLength(0);
  });

  it('same for reschedule and cancellation kinds', async () => {
    state.ledgerStatus = 'SUPERSEDED_BY_MANUAL';
    await processor!({ data: { appointmentId: 'a1', kind: 'reschedule' } });
    await processor!({ data: { appointmentId: 'a1', kind: 'cancellation' } });
    expect(senders.reschedule).not.toHaveBeenCalled();
    expect(senders.cancellation).not.toHaveBeenCalled();
  });

  it('a live SCHEDULED row still sends exactly as before (regression)', async () => {
    await processor!({ data: { appointmentId: 'a1', kind: 'confirmation' } });
    expect(senders.confirmation).toHaveBeenCalledWith({ appointmentId: 'a1', force: false });
    expect(state.outcomes[0]).toMatchObject({ data: { status: 'SENT' } });
  });

  it('an admin-pressed outbox Send is human-initiated and ignores the guard', async () => {
    state.ledgerStatus = 'SUPERSEDED_BY_MANUAL';
    await processor!({ data: { appointmentId: 'a1', kind: 'confirmation', adminSend: true } });
    expect(senders.confirmation).toHaveBeenCalledWith({ appointmentId: 'a1', force: true });
  });
});
