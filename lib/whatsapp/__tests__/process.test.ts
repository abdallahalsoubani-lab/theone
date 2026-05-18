import { AppointmentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory DB stub. Each test resets via the helpers exported below.
vi.mock('@/lib/db', () => {
  const state = {
    users: [] as Array<{ id: string; phone: string; deletedAt: Date | null }>,
    outboundMessages: [] as Array<{
      id: string;
      direction: 'OUTBOUND' | 'INBOUND';
      recipientPhone: string;
      appointmentId: string | null;
      sentAt: Date;
      status: string;
      providerMessageId: string | null;
      recipientId: string | null;
      failureReason: string | null;
      deliveredAt: Date | null;
      readAt: Date | null;
    }>,
    inboundMessagesCreated: [] as Array<Record<string, unknown>>,
    appointments: [] as Array<{
      id: string;
      patientId: string;
      status: AppointmentStatus;
      startsAt: Date;
    }>,
    appointmentUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    auditLogs: [] as Array<Record<string, unknown>>,
    inboxItems: [] as Array<Record<string, unknown>>,
    userUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    enqueuedOutbound: [] as Array<Record<string, unknown>>,
  };
  let inboundCounter = 0;
  return {
    __state: state,
    db: {
      user: {
        findFirst: vi.fn(
          async ({ where }: { where: { phone: string } }) =>
            state.users.find((u) => u.phone === where.phone && u.deletedAt === null) ?? null,
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            state.userUpdates.push({ id: where.id, data });
            return { id: where.id };
          },
        ),
      },
      whatsAppMessage: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if ('providerMessageId' in where) {
            return (
              state.outboundMessages.find((m) => m.providerMessageId === where.providerMessageId) ??
              null
            );
          }
          // recent-outbound lookup
          const phone = where.recipientPhone as string;
          const after = (where.sentAt as { gte: Date }).gte;
          return (
            state.outboundMessages
              .filter(
                (m) =>
                  m.direction === 'OUTBOUND' &&
                  m.recipientPhone === phone &&
                  m.appointmentId !== null &&
                  m.sentAt.getTime() >= after.getTime(),
              )
              .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0] ?? null
          );
        }),
        create: vi.fn(
          async ({ data, select }: { data: Record<string, unknown>; select?: { id: boolean } }) => {
            inboundCounter += 1;
            const id = `in-${inboundCounter}`;
            state.inboundMessagesCreated.push({ id, ...data });
            return select?.id ? { id } : { id, ...data };
          },
        ),
        update: vi.fn(async () => undefined),
      },
      appointment: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.appointments.find((a) => a.id === where.id) ?? null,
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            state.appointmentUpdates.push({ id: where.id, data });
            const appt = state.appointments.find((a) => a.id === where.id);
            if (appt && typeof data.status === 'string') {
              appt.status = data.status as AppointmentStatus;
            }
            return appt;
          },
        ),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.auditLogs.push(data);
          return data;
        }),
      },
      inboxItem: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.inboxItems.push(data);
          return data;
        }),
      },
    },
  };
});

// Redis stub for the dedupe set.
vi.mock('@/lib/queue/client', () => {
  const processed = new Set<string>();
  return {
    queueRedis: {
      set: vi.fn(async (key: string, _v: string, _ex: string, _ttl: number, mode: string) => {
        if (mode === 'NX' && processed.has(key)) return null;
        processed.add(key);
        return 'OK';
      }),
    },
    __resetProcessed: () => processed.clear(),
  };
});

// Enqueue stub — record what would have been sent without touching Redis/BullMQ.
vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({
  enqueueWhatsappOutbound: vi.fn(async (job: Record<string, unknown>) => {
    const dbModule = (await vi.importMock('@/lib/db')) as {
      __state: { enqueuedOutbound: Array<Record<string, unknown>> };
    };
    dbModule.__state.enqueuedOutbound.push(job);
    return `enq-${dbModule.__state.enqueuedOutbound.length}`;
  }),
}));

import { processWebhookEvent } from '../inbound/process';
import * as dbModule from '@/lib/db';
import * as redisModule from '@/lib/queue/client';

type DbState = {
  users: Array<{ id: string; phone: string; deletedAt: Date | null }>;
  outboundMessages: Array<{
    id: string;
    direction: 'OUTBOUND' | 'INBOUND';
    recipientPhone: string;
    appointmentId: string | null;
    sentAt: Date;
    status: string;
    providerMessageId: string | null;
    recipientId: string | null;
    failureReason: string | null;
    deliveredAt: Date | null;
    readAt: Date | null;
  }>;
  inboundMessagesCreated: Array<Record<string, unknown>>;
  appointments: Array<{ id: string; patientId: string; status: AppointmentStatus; startsAt: Date }>;
  appointmentUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  auditLogs: Array<Record<string, unknown>>;
  inboxItems: Array<Record<string, unknown>>;
  userUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  enqueuedOutbound: Array<Record<string, unknown>>;
};
const state = (dbModule as unknown as { __state: DbState }).__state;
const resetProcessed = (redisModule as unknown as { __resetProcessed: () => void })
  .__resetProcessed;

function reset(): void {
  state.users.length = 0;
  state.outboundMessages.length = 0;
  state.inboundMessagesCreated.length = 0;
  state.appointments.length = 0;
  state.appointmentUpdates.length = 0;
  state.auditLogs.length = 0;
  state.inboxItems.length = 0;
  state.userUpdates.length = 0;
  state.enqueuedOutbound.length = 0;
  resetProcessed();
}

describe('processWebhookEvent — CONFIRM intent', () => {
  beforeEach(() => {
    reset();
    state.users.push({ id: 'patient-1', phone: '+962790000000', deletedAt: null });
    state.appointments.push({
      id: 'appt-1',
      patientId: 'patient-1',
      status: AppointmentStatus.SCHEDULED,
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    state.outboundMessages.push({
      id: 'out-1',
      direction: 'OUTBOUND',
      recipientPhone: '+962790000000',
      appointmentId: 'appt-1',
      sentAt: new Date(Date.now() - 5 * 60 * 1000),
      status: 'SENT',
      providerMessageId: 'out-prov-1',
      recipientId: 'patient-1',
      failureReason: null,
      deliveredAt: null,
      readAt: null,
    });
  });

  it('moves SCHEDULED → CONFIRMED on Arabic "نعم" reply and writes the audit row', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-1',
        fromPhone: '+962790000000',
        body: 'نعم',
        receivedAt: new Date(),
      },
    });
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.CONFIRMED);
    expect(state.appointmentUpdates).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      actorId: 'patient-1',
      entityType: 'Appointment',
      entityId: 'appt-1',
      action: 'UPDATE',
      after: { event: 'CONFIRMED_VIA_WHATSAPP' },
    });
    expect(state.enqueuedOutbound[0]).toMatchObject({ kind: 'text', source: 'inbound_ack' });
  });

  it('handles English "1" confirm', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-2',
        fromPhone: '+962790000000',
        body: '1',
        receivedAt: new Date(),
      },
    });
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it('does not touch an already-CONFIRMED appointment', async () => {
    state.appointments[0]!.status = AppointmentStatus.CONFIRMED;
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-3',
        fromPhone: '+962790000000',
        body: 'yes',
        receivedAt: new Date(),
      },
    });
    // No update issued — appointment was already in CONFIRMED.
    expect(state.appointmentUpdates).toHaveLength(0);
    // But the inbound row is still recorded.
    expect(state.inboundMessagesCreated).toHaveLength(1);
    // And the ack still fires.
    expect(state.enqueuedOutbound).toHaveLength(1);
  });

  it('does not auto-confirm if there is no recent outbound for that phone', async () => {
    state.outboundMessages.length = 0;
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-4',
        fromPhone: '+962790000000',
        body: 'نعم',
        receivedAt: new Date(),
      },
    });
    expect(state.appointmentUpdates).toHaveLength(0);
    // No appointment match → INBOUND_UNKNOWN inbox item
    expect(state.inboxItems[0]).toMatchObject({ type: 'INBOUND_UNKNOWN' });
  });
});

describe('processWebhookEvent — RESCHEDULE_REQUEST', () => {
  beforeEach(() => {
    reset();
    state.users.push({ id: 'patient-1', phone: '+962790000000', deletedAt: null });
    state.appointments.push({
      id: 'appt-1',
      patientId: 'patient-1',
      status: AppointmentStatus.SCHEDULED,
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    state.outboundMessages.push({
      id: 'out-1',
      direction: 'OUTBOUND',
      recipientPhone: '+962790000000',
      appointmentId: 'appt-1',
      sentAt: new Date(Date.now() - 5 * 60 * 1000),
      status: 'SENT',
      providerMessageId: 'out-prov-1',
      recipientId: 'patient-1',
      failureReason: null,
      deliveredAt: null,
      readAt: null,
    });
  });

  it('creates an INBOUND_RESCHEDULE_REQUEST inbox item and an ack', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-5',
        fromPhone: '+962790000000',
        body: 'تغيير',
        receivedAt: new Date(),
      },
    });
    expect(state.inboxItems[0]).toMatchObject({
      type: 'INBOUND_RESCHEDULE_REQUEST',
      patientId: 'patient-1',
      appointmentId: 'appt-1',
    });
    expect(state.appointmentUpdates).toHaveLength(0);
    expect(state.enqueuedOutbound).toHaveLength(1);
  });
});

describe('processWebhookEvent — CANCEL_REQUEST', () => {
  beforeEach(() => {
    reset();
    state.users.push({ id: 'patient-1', phone: '+962790000000', deletedAt: null });
    state.appointments.push({
      id: 'appt-1',
      patientId: 'patient-1',
      status: AppointmentStatus.SCHEDULED,
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    state.outboundMessages.push({
      id: 'out-1',
      direction: 'OUTBOUND',
      recipientPhone: '+962790000000',
      appointmentId: 'appt-1',
      sentAt: new Date(Date.now() - 5 * 60 * 1000),
      status: 'SENT',
      providerMessageId: 'out-prov-1',
      recipientId: 'patient-1',
      failureReason: null,
      deliveredAt: null,
      readAt: null,
    });
  });

  it('creates an INBOUND_CANCEL_REQUEST inbox item without auto-cancelling', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-6',
        fromPhone: '+962790000000',
        body: 'إلغاء',
        receivedAt: new Date(),
      },
    });
    expect(state.inboxItems[0]).toMatchObject({
      type: 'INBOUND_CANCEL_REQUEST',
      patientId: 'patient-1',
      appointmentId: 'appt-1',
    });
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.SCHEDULED);
  });
});

describe('processWebhookEvent — UNKNOWN', () => {
  beforeEach(() => reset());

  it('records the inbound row and an INBOUND_UNKNOWN inbox item with no auto-action', async () => {
    state.users.push({ id: 'patient-1', phone: '+962790000000', deletedAt: null });
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-7',
        fromPhone: '+962790000000',
        body: 'كيفك',
        receivedAt: new Date(),
      },
    });
    expect(state.inboundMessagesCreated[0]).toMatchObject({ intent: 'UNKNOWN' });
    expect(state.inboxItems[0]).toMatchObject({ type: 'INBOUND_UNKNOWN' });
    expect(state.enqueuedOutbound).toHaveLength(0);
  });
});

describe('processWebhookEvent — idempotency', () => {
  beforeEach(() => {
    reset();
    state.users.push({ id: 'patient-1', phone: '+962790000000', deletedAt: null });
    state.appointments.push({
      id: 'appt-1',
      patientId: 'patient-1',
      status: AppointmentStatus.SCHEDULED,
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    state.outboundMessages.push({
      id: 'out-1',
      direction: 'OUTBOUND',
      recipientPhone: '+962790000000',
      appointmentId: 'appt-1',
      sentAt: new Date(Date.now() - 5 * 60 * 1000),
      status: 'SENT',
      providerMessageId: 'out-prov-1',
      recipientId: 'patient-1',
      failureReason: null,
      deliveredAt: null,
      readAt: null,
    });
  });

  it('deduplicates a redelivered inbound webhook with the same providerMessageId', async () => {
    const event = {
      kind: 'inbound' as const,
      message: {
        providerMessageId: 'in-prov-dupe',
        fromPhone: '+962790000000',
        body: 'yes',
        receivedAt: new Date(),
      },
    };
    await processWebhookEvent(event);
    await processWebhookEvent(event);
    expect(state.inboundMessagesCreated).toHaveLength(1);
    expect(state.appointmentUpdates).toHaveLength(1);
  });
});

describe('processWebhookEvent — status updates', () => {
  beforeEach(() => {
    reset();
    state.outboundMessages.push({
      id: 'out-1',
      direction: 'OUTBOUND',
      recipientPhone: '+962790000000',
      appointmentId: 'appt-1',
      sentAt: new Date(),
      status: 'SENT',
      providerMessageId: 'out-prov-1',
      recipientId: 'patient-1',
      failureReason: null,
      deliveredAt: null,
      readAt: null,
    });
  });

  it('updates the outbound row on DELIVERED', async () => {
    await processWebhookEvent({
      kind: 'status',
      status: {
        providerMessageId: 'out-prov-1',
        status: 'DELIVERED',
        occurredAt: new Date(),
      },
    });
    // We don't read the db update back through the mock, but verify the
    // mock call happened.
    const dbm = dbModule as unknown as {
      db: { whatsAppMessage: { update: ReturnType<typeof vi.fn> } };
    };
    expect(dbm.db.whatsAppMessage.update).toHaveBeenCalled();
  });

  it('flips whatsappReachable=false on FAILED status', async () => {
    await processWebhookEvent({
      kind: 'status',
      status: {
        providerMessageId: 'out-prov-1',
        status: 'FAILED',
        occurredAt: new Date(),
        failureReason: 'recipient unreachable',
      },
    });
    expect(state.userUpdates[0]).toMatchObject({
      id: 'patient-1',
      data: { whatsappReachable: false },
    });
  });

  it('skips silently when the outbound row is not yet persisted', async () => {
    await processWebhookEvent({
      kind: 'status',
      status: {
        providerMessageId: 'unknown-id',
        status: 'DELIVERED',
        occurredAt: new Date(),
      },
    });
    expect(state.userUpdates).toHaveLength(0);
  });
});
