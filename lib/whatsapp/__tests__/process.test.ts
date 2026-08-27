import { AppointmentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 48b: notification + clinic-tz mocks (createNotification pulls next-auth).
vi.mock('@/lib/notifications/actions', () => ({
  createNotification: vi.fn(async () => ({ id: 'n' })),
}));
// P51 — the silent-mode gate suppresses button acks entirely; default OFF
// here so every pre-P51 test pins today's behaviour unchanged.
const silentMock = vi.hoisted(() => vi.fn(async () => false));
vi.mock('@/lib/whatsapp/silent-mode', () => ({
  isSilentModeOn: silentMock,
  holdForOutbox: vi.fn(async () => 'held-x'),
  reparkScheduled: vi.fn(async () => undefined),
}));

vi.mock('@/lib/time/clinic-server', () => ({
  getClinicTimeZone: vi.fn(async () => 'Asia/Amman'),
}));

// In-memory DB stub. Each test resets via the helpers exported below.
vi.mock('@/lib/db', () => {
  const state = {
    users: [] as Array<{
      id: string;
      phone: string;
      deletedAt: Date | null;
      languagePref?: 'AR' | 'EN';
      fullNameEn?: string;
      fullNameAr?: string;
      role?: string;
    }>,
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
    attachmentsCreated: [] as Array<Record<string, unknown>>,
    mediaFetchEnqueued: [] as Array<Record<string, unknown>>,
    appointments: [] as Array<{
      id: string;
      patientId: string;
      status: AppointmentStatus;
      startsAt: Date;
      durationMinutes?: number;
    }>,
    appointmentUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    auditLogs: [] as Array<Record<string, unknown>>,
    inboxItems: [] as Array<Record<string, unknown>>,
    userUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    enqueuedOutbound: [] as Array<Record<string, unknown>>,
    // Prompt 49 — thin conversation rows keyed by phone.
    conversations: [] as Array<{
      id: string;
      phone: string;
      patientId: string | null;
      lastInboundAt: Date | null;
      lastMessageAt: Date;
      lastReadAt: Date | null;
      lastHumanReplyAt: Date | null;
    }>,
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
        // Two shapes: the P50 multi-patient phone resolver (where.phone) and
        // the 48b decline staff notification (role in SECRETARY/ADMIN).
        findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
          if (where && 'phone' in where) {
            return state.users.filter((u) => u.phone === where.phone && u.deletedAt === null);
          }
          return state.users.filter((u) => u.role === 'SECRETARY' || u.role === 'ADMIN');
        }),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            state.userUpdates.push({ id: where.id, data });
            return { id: where.id };
          },
        ),
      },
      whatsAppAttachment: {
        create: vi.fn(
          async ({ data, select }: { data: Record<string, unknown>; select?: { id: boolean } }) => {
            const id = `att-${state.attachmentsCreated.length + 1}`;
            state.attachmentsCreated.push({ id, ...data });
            return select?.id ? { id } : { id, ...data };
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
        // 48b: "which of these appointments had a reminder sent" sweep —
        // any OUTBOUND row with a matching appointmentId counts as reminded
        // in this harness.
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const idIn = (where.appointmentId as { in?: string[] } | undefined)?.in ?? [];
          return state.outboundMessages
            .filter(
              (m) =>
                m.direction === 'OUTBOUND' && m.appointmentId && idIn.includes(m.appointmentId),
            )
            .map((m) => ({ appointmentId: m.appointmentId }));
        }),
      },
      appointment: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.appointments.find((a) => a.id === where.id) ?? null,
        ),
        // 48b resolver: upcoming-by-patient AND run-by-ids shapes.
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const withDur = (a: (typeof state.appointments)[number]) => ({
            durationMinutes: 30,
            ...a,
          });
          const idIn = (where.id as { in?: string[] } | undefined)?.in;
          if (idIn) return state.appointments.filter((a) => idIn.includes(a.id)).map(withDur);
          const statuses = (where.status as { in?: string[] } | undefined)?.in;
          const gte = (where.startsAt as { gte?: Date } | undefined)?.gte;
          // P50: the resolver scopes by patientId IN [family ids].
          const patientIn = (where.patientId as { in?: string[] } | undefined)?.in;
          return state.appointments
            .filter(
              (a) =>
                (patientIn ? patientIn.includes(a.patientId) : a.patientId === where.patientId) &&
                (!statuses || statuses.includes(a.status)) &&
                (!gte || a.startsAt.getTime() >= gte.getTime()),
            )
            .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())
            .map(withDur);
        }),
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
      whatsAppConversation: {
        upsert: vi.fn(
          async ({
            where,
            update,
            create,
          }: {
            where: { phone: string };
            update: Record<string, unknown>;
            create: Record<string, unknown>;
          }) => {
            let row = state.conversations.find((c) => c.phone === where.phone);
            if (row) {
              Object.assign(row, update);
            } else {
              row = {
                id: `conv-${state.conversations.length + 1}`,
                phone: where.phone,
                patientId: (create.patientId as string | null) ?? null,
                lastInboundAt: (create.lastInboundAt as Date | null) ?? null,
                lastMessageAt: create.lastMessageAt as Date,
                lastReadAt: null,
                lastHumanReplyAt: null,
              };
              state.conversations.push(row);
            }
            return { id: row.id, lastHumanReplyAt: row.lastHumanReplyAt };
          },
        ),
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

// P56 — capture inbound media fetch enqueues.
vi.mock('@/lib/queue/jobs/whatsappMedia', () => ({
  enqueueInboundMediaFetch: vi.fn(async (job: Record<string, unknown>) => {
    const dbModule = (await vi.importMock('@/lib/db')) as {
      __state: { mediaFetchEnqueued: Array<Record<string, unknown>> };
    };
    dbModule.__state.mediaFetchEnqueued.push(job);
  }),
}));

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
  users: Array<{
    id: string;
    phone: string;
    deletedAt: Date | null;
    languagePref?: 'AR' | 'EN';
    fullNameEn?: string;
    fullNameAr?: string;
    role?: string;
  }>;
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
  attachmentsCreated: Array<Record<string, unknown>>;
  mediaFetchEnqueued: Array<Record<string, unknown>>;
  appointments: Array<{
    id: string;
    patientId: string;
    status: AppointmentStatus;
    startsAt: Date;
    durationMinutes?: number;
  }>;
  appointmentUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  auditLogs: Array<Record<string, unknown>>;
  inboxItems: Array<Record<string, unknown>>;
  userUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  enqueuedOutbound: Array<Record<string, unknown>>;
  conversations: Array<{
    id: string;
    phone: string;
    patientId: string | null;
    lastInboundAt: Date | null;
    lastMessageAt: Date;
    lastReadAt: Date | null;
    lastHumanReplyAt: Date | null;
  }>;
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
  state.conversations.length = 0;
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

  it('48b resolution: confirms the NEXT UPCOMING appointment even without a recent outbound (reminded-first, upcoming fallback)', async () => {
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
    expect(state.appointmentUpdates).toHaveLength(1);
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it('does not confirm anything when the patient has NO upcoming appointment at all', async () => {
    state.outboundMessages.length = 0;
    state.appointments.length = 0;
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-4b',
        fromPhone: '+962790000000',
        body: 'نعم',
        receivedAt: new Date(),
      },
    });
    expect(state.appointmentUpdates).toHaveLength(0);
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

  it('creates an INBOUND_RESCHEDULE_REQUEST inbox item with NO ack (owner ruling: only confirm/decline acks exist)', async () => {
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
    // The old bilingual reschedule ack is REMOVED — the request lands unread
    // in the WhatsApp Inbox and a human answers.
    expect(state.enqueuedOutbound).toHaveLength(0);
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
  beforeEach(() => {
    reset();
    state.users.push({ id: 'patient-1', phone: '+962790000000', deletedAt: null });
  });

  it('unregistered numbers stay silent (no auto-reply)', async () => {
    state.users.length = 0;
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-9',
        fromPhone: '+962799999999',
        body: 'مرحبا',
        receivedAt: new Date(),
      },
    });
    expect(state.enqueuedOutbound).toHaveLength(0);
  });

  it('P49: records the inbound row + inbox item with NO auto-reply — the 48b soft generic is removed', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-7',
        fromPhone: '+962790000000',
        body: 'مرحبا كيفكم',
        receivedAt: new Date(),
      },
    });
    expect(state.inboxItems[0]).toMatchObject({ type: 'INBOUND_UNKNOWN' });
    expect(state.appointmentUpdates).toHaveLength(0);
    // The message lands UNREAD in the WhatsApp Inbox instead of getting a
    // canned reply — a human answers now.
    expect(state.enqueuedOutbound).toHaveLength(0);

    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'in-prov-8',
        fromPhone: '+962790000000',
        body: 'رسالة اخرى',
        receivedAt: new Date(),
      },
    });
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

// ─── Prompt 48b additions ───────────────────────────────────────────────────

import { createNotification } from '@/lib/notifications/actions';

describe('48b — quick-reply buttons', () => {
  beforeEach(() => {
    reset();
    state.users.push({
      id: 'patient-1',
      phone: '+962790000000',
      deletedAt: null,
      languagePref: 'AR',
      fullNameAr: 'سارة خليل',
      fullNameEn: 'Sara Khalil',
    });
    state.users.push({ id: 'sec-1', phone: '+962000', deletedAt: null, role: 'SECRETARY' });
    state.appointments.push({
      id: 'appt-1',
      patientId: 'patient-1',
      status: AppointmentStatus.SCHEDULED,
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    vi.mocked(createNotification).mockClear();
  });

  it('ButtonPayload=confirm → CONFIRMED + the NEW ack wording with the patient name', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'btn-1',
        fromPhone: '+962790000000',
        body: 'تأكيد الحضور',
        buttonPayload: 'confirm',
        buttonText: 'تأكيد الحضور',
        receivedAt: new Date(),
      },
    });
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.CONFIRMED);
    const ack = String((state.enqueuedOutbound[0] as { body?: string }).body);
    expect(ack).toContain('مرحباً Sara Khalil، تم التأكيد على موعدكم'); // P47 row 8 — English name
    expect(ack).toContain('دوام الصحة والعافية');
  });

  it('ButtonPayload=decline → NO cancellation + secretary notification + decline ack', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'btn-2',
        fromPhone: '+962790000000',
        body: 'عدم التأكيد',
        buttonPayload: 'decline',
        buttonText: 'عدم التأكيد',
        receivedAt: new Date(),
      },
    });
    // The appointment is untouched — no auto-cancel ANYWHERE (48b core rule).
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.SCHEDULED);
    expect(state.appointmentUpdates).toHaveLength(0);
    // Secretary+admin in-app notification fired.
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PATIENT_DECLINED_APPOINTMENT',
        recipientId: 'sec-1',
        linkPath: '/secretary/confirmations',
      }),
    );
    // Decline ack in the patient's language.
    const ack = String((state.enqueuedOutbound[0] as { body?: string }).body);
    expect(ack).toContain('شكراً لإبلاغنا');
  });
});

describe('48b — back-to-back run confirm (P27 mirror)', () => {
  beforeEach(() => {
    reset();
    state.users.push({ id: 'patient-1', phone: '+962790000000', deletedAt: null });
    const base = Date.now() + 60 * 60 * 1000;
    // Two zero-gap appointments (30min each) + one spaced-apart later.
    state.appointments.push(
      {
        id: 'run-a',
        patientId: 'patient-1',
        status: AppointmentStatus.SCHEDULED,
        startsAt: new Date(base),
      },
      {
        id: 'run-b',
        patientId: 'patient-1',
        status: AppointmentStatus.SCHEDULED,
        startsAt: new Date(base + 30 * 60 * 1000),
      },
      {
        id: 'later',
        patientId: 'patient-1',
        status: AppointmentStatus.SCHEDULED,
        startsAt: new Date(base + 5 * 60 * 60 * 1000),
      },
    );
  });

  it('one confirm reply confirms the WHOLE zero-gap run, not the spaced-apart one', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'run-1',
        fromPhone: '+962790000000',
        body: 'نعم',
        receivedAt: new Date(),
      },
    });
    const byId = new Map(state.appointments.map((a) => [a.id, a.status]));
    expect(byId.get('run-a')).toBe(AppointmentStatus.CONFIRMED);
    expect(byId.get('run-b')).toBe(AppointmentStatus.CONFIRMED);
    expect(byId.get('later')).toBe(AppointmentStatus.SCHEDULED);
    // Audited per transition (two rows).
    expect(
      state.auditLogs.filter(
        (l) => (l.after as { event?: string })?.event === 'CONFIRMED_VIA_WHATSAPP',
      ),
    ).toHaveLength(2);
  });
});

describe('48b — a confirm can never resurrect a terminal booking', () => {
  it('cancelled appointment: no status change, no misleading ack (documented silence)', async () => {
    reset();
    state.users.push({ id: 'patient-1', phone: '+962790000000', deletedAt: null });
    state.appointments.push({
      id: 'appt-x',
      patientId: 'patient-1',
      status: AppointmentStatus.CANCELLED,
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    state.outboundMessages.push({
      id: 'out-x',
      direction: 'OUTBOUND',
      recipientPhone: '+962790000000',
      appointmentId: 'appt-x',
      sentAt: new Date(Date.now() - 5 * 60 * 1000),
      status: 'SENT',
      providerMessageId: 'out-prov-x',
      recipientId: 'patient-1',
      failureReason: null,
      deliveredAt: null,
      readAt: null,
    });
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'dead-1',
        fromPhone: '+962790000000',
        body: 'yes',
        receivedAt: new Date(),
      },
    });
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.CANCELLED);
    expect(state.appointmentUpdates).toHaveLength(0);
    expect(state.enqueuedOutbound).toHaveLength(0);
  });
});

// ─── Prompt 49 additions ────────────────────────────────────────────────────

describe('P50 — shared family number resolves across ALL patients on it', () => {
  const FAMILY_PHONE = '+962790000000';

  beforeEach(() => {
    reset();
    // Two siblings share the parent's phone.
    state.users.push(
      { id: 'child-a', phone: FAMILY_PHONE, deletedAt: null, languagePref: 'AR' },
      { id: 'child-b', phone: FAMILY_PHONE, deletedAt: null, languagePref: 'AR' },
    );
    const base = Date.now();
    state.appointments.push(
      // child-a: appointment further out, NOT reminded.
      {
        id: 'appt-a',
        patientId: 'child-a',
        status: AppointmentStatus.SCHEDULED,
        startsAt: new Date(base + 4 * 60 * 60 * 1000),
      },
      // child-b: nearer appointment that HAD a reminder sent.
      {
        id: 'appt-b',
        patientId: 'child-b',
        status: AppointmentStatus.SCHEDULED,
        startsAt: new Date(base + 2 * 60 * 60 * 1000),
      },
    );
    state.outboundMessages.push({
      id: 'out-rem-b',
      direction: 'OUTBOUND',
      recipientPhone: FAMILY_PHONE,
      appointmentId: 'appt-b',
      sentAt: new Date(base - 60 * 60 * 1000),
      status: 'SENT',
      providerMessageId: 'rem-b',
      recipientId: 'child-b',
      failureReason: null,
      deliveredAt: null,
      readAt: null,
    });
  });

  it('"نعم" confirms the REMINDED child\'s appointment and leaves the sibling untouched', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'p50-fam-1',
        fromPhone: FAMILY_PHONE,
        body: 'نعم',
        receivedAt: new Date(),
      },
    });
    const byId = new Map(state.appointments.map((a) => [a.id, a.status]));
    expect(byId.get('appt-b')).toBe(AppointmentStatus.CONFIRMED);
    expect(byId.get('appt-a')).toBe(AppointmentStatus.SCHEDULED);
    // Audit attributes the confirm to the appointment's OWNER (child-b).
    expect(state.auditLogs[0]).toMatchObject({ actorId: 'child-b', entityId: 'appt-b' });
  });

  it('sibling adjacent bookings are NOT swept into the run (same-patient semantics)', async () => {
    // Make the two siblings back-to-back: a run only within one patient.
    state.appointments[0]!.startsAt = new Date(
      state.appointments[1]!.startsAt.getTime() + 30 * 60 * 1000,
    );
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'p50-fam-2',
        fromPhone: FAMILY_PHONE,
        body: 'نعم',
        receivedAt: new Date(),
      },
    });
    const byId = new Map(state.appointments.map((a) => [a.id, a.status]));
    expect(byId.get('appt-b')).toBe(AppointmentStatus.CONFIRMED);
    expect(byId.get('appt-a')).toBe(AppointmentStatus.SCHEDULED);
  });
});

describe('P49 — conversation bookkeeping on inbound', () => {
  beforeEach(() => {
    reset();
    state.users.push({ id: 'patient-1', phone: '+962790000000', deletedAt: null });
  });

  it('upserts the conversation row: lastInboundAt anchors the 24h window, patient linked by phone', async () => {
    const receivedAt = new Date();
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'p49-conv-1',
        fromPhone: '+962790000000',
        body: 'مرحبا',
        receivedAt,
      },
    });
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]).toMatchObject({
      phone: '+962790000000',
      patientId: 'patient-1',
      lastInboundAt: receivedAt,
      lastMessageAt: receivedAt,
    });
  });

  it('LIVE REGRESSION: "شكرا" → NO auto-reply of any kind, lands UNREAD in the inbox', async () => {
    const receivedAt = new Date();
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'p49fix-thanks',
        fromPhone: '+962790000000',
        body: 'شكرا',
        receivedAt,
      },
    });
    // Nothing goes out — not an ack, not a generic, nothing.
    expect(state.enqueuedOutbound).toHaveLength(0);
    // The message is recorded and surfaces for a human.
    expect(state.inboxItems[0]).toMatchObject({ type: 'INBOUND_UNKNOWN' });
    // Unread: lastInboundAt stamped, lastReadAt untouched.
    expect(state.conversations[0]).toMatchObject({ lastInboundAt: receivedAt, lastReadAt: null });
  });

  it('unknown number → conversation row with patientId=null (the "Unknown numbers" section)', async () => {
    state.users.length = 0;
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'p49-conv-2',
        fromPhone: '+962799999999',
        body: 'مرحبا',
        receivedAt: new Date(),
      },
    });
    expect(state.conversations[0]).toMatchObject({
      phone: '+962799999999',
      patientId: null,
    });
  });
});

describe('P49 — 1h ack suppression after a manual reply', () => {
  beforeEach(() => {
    reset();
    state.users.push({ id: 'patient-1', phone: '+962790000000', deletedAt: null });
    state.users.push({ id: 'sec-1', phone: '+962000', deletedAt: null, role: 'SECRETARY' });
    state.appointments.push({
      id: 'appt-1',
      patientId: 'patient-1',
      status: AppointmentStatus.SCHEDULED,
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  function seedConversation(lastHumanReplyAt: Date | null): void {
    state.conversations.push({
      id: 'conv-seed',
      phone: '+962790000000',
      patientId: 'patient-1',
      lastInboundAt: new Date(Date.now() - 10 * 60 * 1000),
      lastMessageAt: new Date(Date.now() - 10 * 60 * 1000),
      lastReadAt: null,
      lastHumanReplyAt,
    });
  }

  it('human replied 10min ago → confirm STILL transitions the status (+audit) but the ack is skipped', async () => {
    seedConversation(new Date(Date.now() - 10 * 60 * 1000));
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'p49-sup-1',
        fromPhone: '+962790000000',
        body: 'نعم',
        receivedAt: new Date(),
      },
    });
    // The status transition is NEVER blocked by suppression (§1.2 hard rule).
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.CONFIRMED);
    expect(
      state.auditLogs.filter(
        (l) => (l.after as { event?: string })?.event === 'CONFIRMED_VIA_WHATSAPP',
      ),
    ).toHaveLength(1);
    // …but no auto-ack goes out while a human owns the thread.
    expect(state.enqueuedOutbound).toHaveLength(0);
  });

  it('human replied 61min ago → suppression expired, the confirm ack fires again', async () => {
    seedConversation(new Date(Date.now() - 61 * 60 * 1000));
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'p49-sup-2',
        fromPhone: '+962790000000',
        body: 'نعم',
        receivedAt: new Date(),
      },
    });
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.CONFIRMED);
    expect(state.enqueuedOutbound).toHaveLength(1);
    expect(state.enqueuedOutbound[0]).toMatchObject({ source: 'inbound_ack' });
  });

  it('decline under suppression: inbox item + staff notification still fire, only the ack is skipped', async () => {
    seedConversation(new Date(Date.now() - 10 * 60 * 1000));
    vi.mocked(createNotification).mockClear();
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'p49-sup-3',
        fromPhone: '+962790000000',
        body: 'عدم التأكيد',
        buttonPayload: 'decline',
        buttonText: 'عدم التأكيد',
        receivedAt: new Date(),
      },
    });
    expect(state.inboxItems[0]).toMatchObject({ type: 'INBOUND_CANCEL_REQUEST' });
    expect(vi.mocked(createNotification)).toHaveBeenCalled();
    expect(state.enqueuedOutbound).toHaveLength(0);
  });
});

// ─── P51 — silent mode suppresses button acks entirely ─────────────────────

describe('P51 — silent mode suppresses reply-button acks (never held, only logged)', () => {
  beforeEach(() => {
    reset();
    silentMock.mockResolvedValue(true);
    state.users.push({
      id: 'patient-1',
      phone: '+962790000000',
      deletedAt: null,
      languagePref: 'AR',
      fullNameAr: 'سارة خليل',
      fullNameEn: 'Sara Khalil',
    });
    state.users.push({ id: 'sec-1', phone: '+962000', deletedAt: null, role: 'SECRETARY' });
    state.appointments.push({
      id: 'appt-1',
      patientId: 'patient-1',
      status: AppointmentStatus.SCHEDULED,
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  it('confirm still flips the status, but NO ack is enqueued; a log line fires instead', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'silent-btn-1',
        fromPhone: '+962790000000',
        body: 'تأكيد الحضور',
        buttonPayload: 'confirm',
        buttonText: 'تأكيد الحضور',
        receivedAt: new Date(),
      },
    });
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.CONFIRMED);
    expect(state.enqueuedOutbound).toHaveLength(0);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('[silent-mode]'))).toBe(true);
    warn.mockRestore();
  });

  it('decline: inbox item + secretary notification still fire, the ack does not', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'silent-btn-2',
        fromPhone: '+962790000000',
        body: 'إلغاء',
        buttonPayload: 'decline',
        buttonText: 'إلغاء',
        receivedAt: new Date(),
      },
    });
    expect(state.enqueuedOutbound).toHaveLength(0);
  });

  it('silent OFF → the ack sends again (gate is live, not sticky)', async () => {
    silentMock.mockResolvedValue(false);
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'silent-btn-3',
        fromPhone: '+962790000000',
        body: 'تأكيد الحضور',
        buttonPayload: 'confirm',
        buttonText: 'تأكيد الحضور',
        receivedAt: new Date(),
      },
    });
    expect(state.enqueuedOutbound.length).toBeGreaterThan(0);
  });
});

// ─── P56 — inbound media capture ────────────────────────────────────────────

describe('P56 — inbound media', () => {
  beforeEach(() => {
    reset();
    state.attachmentsCreated.length = 0;
    state.mediaFetchEnqueued.length = 0;
    state.users.push({
      id: 'patient-1',
      phone: '+962790000000',
      deletedAt: null,
      languagePref: 'AR',
      fullNameAr: 'سارة',
      fullNameEn: 'Sara',
    });
  });

  it('a media message (empty body) creates the message + a PENDING attachment + a fetch job', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'MM_1',
        fromPhone: '+962790000000',
        body: '',
        receivedAt: new Date(),
        media: [{ url: 'https://api.twilio.com/m0', contentType: 'image/jpeg' }],
      },
    });
    // The message row is still created (never lost) with an empty body.
    expect(state.inboundMessagesCreated).toHaveLength(1);
    expect(state.inboundMessagesCreated[0]!.body).toBe('');
    // One PENDING attachment, linked, and a fetch job enqueued.
    expect(state.attachmentsCreated).toHaveLength(1);
    expect(state.attachmentsCreated[0]).toMatchObject({
      contentType: 'image/jpeg',
      status: 'PENDING',
      mediaIndex: 0,
    });
    expect(state.mediaFetchEnqueued).toHaveLength(1);
    expect(state.mediaFetchEnqueued[0]).toMatchObject({ mediaUrl: 'https://api.twilio.com/m0' });
  });

  it('NumMedia=2 → two attachments + two fetch jobs', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'MM_2',
        fromPhone: '+962790000000',
        body: '',
        receivedAt: new Date(),
        media: [
          { url: 'https://x/m0', contentType: 'image/png' },
          { url: 'https://x/m1', contentType: 'video/mp4' },
        ],
      },
    });
    expect(state.attachmentsCreated).toHaveLength(2);
    expect(state.mediaFetchEnqueued).toHaveLength(2);
  });

  it('a plain text message creates NO attachment (regression)', async () => {
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'SM_txt',
        fromPhone: '+962790000000',
        body: 'مرحبا',
        receivedAt: new Date(),
      },
    });
    expect(state.inboundMessagesCreated).toHaveLength(1);
    expect(state.attachmentsCreated).toHaveLength(0);
    expect(state.mediaFetchEnqueued).toHaveLength(0);
  });
});

describe('P57 — shared number: ONE rule routes recipientId, InboxItem, conversation and P56 media', () => {
  const FAMILY_PHONE = '+962790000000';

  beforeEach(() => {
    reset();
    state.users.push(
      { id: 'child-a', phone: FAMILY_PHONE, deletedAt: null, languagePref: 'AR' },
      { id: 'child-b', phone: FAMILY_PHONE, deletedAt: null, languagePref: 'AR' },
    );
  });

  it('an inbound photo lands on the patient with the NEAREST active appointment — never the sibling', async () => {
    const base = Date.now();
    state.appointments.push(
      {
        id: 'appt-a',
        patientId: 'child-a',
        status: AppointmentStatus.SCHEDULED,
        startsAt: new Date(base + 26 * 60 * 60 * 1000),
      },
      {
        id: 'appt-b',
        patientId: 'child-b',
        status: AppointmentStatus.CONFIRMED,
        startsAt: new Date(base + 3 * 60 * 60 * 1000),
      },
    );
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'p57-media-1',
        fromPhone: FAMILY_PHONE,
        body: '',
        receivedAt: new Date(),
        media: [{ url: 'https://api.twilio.com/media/1', contentType: 'image/jpeg' }],
      },
    });
    const inbound = state.inboundMessagesCreated;
    expect(inbound).toHaveLength(1);
    expect(inbound[0]!.recipientId).toBe('child-b');
    // The attachment hangs off THAT message and nothing references child-a.
    expect(state.attachmentsCreated).toHaveLength(1);
    expect(state.attachmentsCreated[0]!.messageId).toBe(inbound[0]!.id);
    expect(JSON.stringify([...inbound, ...state.attachmentsCreated])).not.toContain('child-a');
  });

  it('no active appointment on the number → the most recently active sibling, and the inbox item follows', async () => {
    const base = Date.now();
    state.appointments.push(
      {
        id: 'old-a',
        patientId: 'child-a',
        status: AppointmentStatus.COMPLETED,
        startsAt: new Date(base - 2 * 24 * 60 * 60 * 1000),
      },
      {
        id: 'old-b',
        patientId: 'child-b',
        status: AppointmentStatus.COMPLETED,
        startsAt: new Date(base - 30 * 24 * 60 * 60 * 1000),
      },
    );
    await processWebhookEvent({
      kind: 'inbound',
      message: {
        providerMessageId: 'p57-recent-1',
        fromPhone: FAMILY_PHONE,
        body: 'مرحبا عندي سؤال',
        receivedAt: new Date(),
      },
    });
    expect(state.inboundMessagesCreated[0]!.recipientId).toBe('child-a');
    expect(state.inboxItems.at(-1)).toMatchObject({
      type: 'INBOUND_UNKNOWN',
      patientId: 'child-a',
    });
  });
});
