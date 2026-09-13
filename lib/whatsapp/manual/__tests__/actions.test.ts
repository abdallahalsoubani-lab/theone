import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P60 — the action layer: RBAC through requirePermission (Act-As resolves
 * to the effective user), the duplicate guard (needsConfirmation with the
 * time, then `confirmResend` sends with resend=true), input validation and
 * localized error mapping.
 */
const permission = vi.hoisted(() => ({
  user: { id: 'sec-1', role: 'SECRETARY' } as { id: string; role: string } | null,
}));
// The real @/lib/db barrel drags next-auth into the test runtime; the action
// only needs the error mapper from it.
vi.mock('@/lib/db', () => ({
  toLocalizedError: (e: unknown) => ({
    code: 'DB_ERROR',
    message_en: String(e),
    message_ar: String(e),
  }),
}));
vi.mock('@/lib/rbac/guards', () => ({
  requirePermission: vi.fn(async (code: string) => {
    if (!permission.user) throw new Error(`FORBIDDEN:${code}`);
    return permission.user;
  }),
}));

const svc = vi.hoisted(() => ({
  lastSent: null as Date | null,
  /** P61 — which recipients the duplicate guard reports as already-sent. */
  lastSentIds: ['p1'] as string[],
  recipients: [{ id: 'p1' }] as Array<{ id: string }>,
  sendCalls: [] as Array<Record<string, unknown>>,
  sendThrows: null as string | null,
  /** Per-recipient outcomes the mocked service reports back. */
  results: null as Array<Record<string, unknown>> | null,
}));

vi.mock('../recipients', () => ({
  loadMessageRecipients: vi.fn(async () => svc.recipients),
}));
// The service is mocked whole (its real import chain reaches next-auth via
// withAudit); the error class is re-declared here with the same shape so the
// action's `instanceof` check sees the class it imported.
vi.mock('../service', () => {
  class ManualSendError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = 'ManualSendError';
    }
  }
  return {
    ManualSendError,
    lastSentByRecipient: vi.fn(
      async () => new Map(svc.lastSent ? svc.lastSentIds.map((id) => [id, svc.lastSent!]) : []),
    ),
    sendManualAppointmentMessage: vi.fn(async (args: Record<string, unknown>) => {
      if (svc.sendThrows) throw new ManualSendError(svc.sendThrows);
      svc.sendCalls.push(args);
      const ids = (args.recipientIds as string[] | undefined) ?? svc.recipients.map((r) => r.id);
      return {
        appointmentId: 'a1',
        type: args.type,
        batchId: 'batch-1',
        sentAt: new Date('2030-05-10T08:00:00Z'),
        results:
          svc.results ??
          ids.map((patientId) => ({
            patientId,
            ok: true,
            result: {
              appointmentId: 'a1',
              recipientId: patientId,
              type: args.type,
              jobId: 'job-1',
              templateName: 'appointment_confirmation_v2',
              language: 'AR',
              sentAt: new Date('2030-05-10T08:00:00Z'),
              resend: args.resend,
              batchId: 'batch-1',
              closedDispatch: 0,
            },
          })),
      };
    }),
    getManualMessageOptions: vi.fn(async () => ({
      recipients: [
        {
          patientId: 'p1',
          fullNameEn: 'Sara Khalil',
          fullNameAr: 'سارة خليل',
          language: 'AR',
          firstName: 'سارة',
          hasPhone: true,
        },
      ],
      customFrameByLanguage: { AR: null },
      customApprovedByLanguage: { AR: false, EN: false },
      options: [
        {
          type: 'CONFIRMATION',
          applicableRecipientIds: ['p1'],
          previewByLanguage: { AR: 'p' },
          lastSentByRecipient: { p1: new Date('2030-05-01T10:00:00Z') },
        },
      ],
    })),
  };
});

import { getManualMessageOptionsAction, sendManualAppointmentMessageAction } from '../actions';

beforeEach(() => {
  permission.user = { id: 'sec-1', role: 'SECRETARY' };
  svc.lastSent = null;
  svc.lastSentIds = ['p1'];
  svc.recipients = [{ id: 'p1' }];
  svc.sendCalls = [];
  svc.sendThrows = null;
  svc.results = null;
});

describe('sendManualAppointmentMessageAction', () => {
  it('first send of a type goes straight through with resend=false and the acting user', async () => {
    const r = await sendManualAppointmentMessageAction({
      appointmentId: 'a1',
      type: 'CONFIRMATION',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      needsConfirmation: false,
      batchId: 'batch-1',
      sentCount: 1,
      totalCount: 1,
    });
    expect(svc.sendCalls[0]).toMatchObject({
      appointmentId: 'a1',
      type: 'CONFIRMATION',
      resend: false,
      actorId: 'sec-1',
    });
  });

  it('duplicate guard: an earlier send returns needsConfirmation + its time and sends NOTHING', async () => {
    svc.lastSent = new Date('2030-05-01T10:00:00Z');
    const r = await sendManualAppointmentMessageAction({
      appointmentId: 'a1',
      type: 'CONFIRMATION',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      needsConfirmation: true,
      alreadySent: [{ patientId: 'p1', lastSentAt: '2030-05-01T10:00:00.000Z' }],
    });
    expect(svc.sendCalls).toHaveLength(0);
  });

  it('confirmResend=true sends again with resend=true', async () => {
    svc.lastSent = new Date('2030-05-01T10:00:00Z');
    const r = await sendManualAppointmentMessageAction({
      appointmentId: 'a1',
      type: 'CONFIRMATION',
      confirmResend: true,
    });
    expect(r.ok).toBe(true);
    expect(svc.sendCalls[0]).toMatchObject({ resend: true });
  });

  it('service errors map to localized failures', async () => {
    svc.sendThrows = 'CUSTOM_TEMPLATE_PENDING';
    const r = await sendManualAppointmentMessageAction({
      appointmentId: 'a1',
      type: 'CUSTOM',
      customText: 'hi',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('CUSTOM_TEMPLATE_PENDING');
    expect(r.error.message_ar).toContain('قيد الاعتماد');
  });

  it('rejects an unknown type before touching the service', async () => {
    const r = await sendManualAppointmentMessageAction({ appointmentId: 'a1', type: 'NOPE' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('VALIDATION');
    expect(svc.sendCalls).toHaveLength(0);
  });

  it('RBAC denial (doctor / therapist) propagates from requirePermission', async () => {
    permission.user = null;
    await expect(
      sendManualAppointmentMessageAction({ appointmentId: 'a1', type: 'CONFIRMATION' }),
    ).rejects.toThrow(/FORBIDDEN:whatsapp_manual\.send/);
    await expect(getManualMessageOptionsAction('a1')).rejects.toThrow(
      /FORBIDDEN:whatsapp_manual\.send/,
    );
  });
});

describe('getManualMessageOptionsAction', () => {
  it('serializes dates as ISO strings for the client', async () => {
    const r = await getManualMessageOptionsAction('a1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.options[0]).toEqual({
      type: 'CONFIRMATION',
      applicableRecipientIds: ['p1'],
      previewByLanguage: { AR: 'p' },
      lastSentByRecipient: { p1: '2030-05-01T10:00:00.000Z' },
    });
  });
});

/**
 * P61 §1.3.4 — the action layer for a multi-patient appointment: the
 * duplicate guard names WHO already received the type, a partial batch is
 * reported per patient, and the recipient set reaches the service verbatim
 * (the service, not the action, re-derives what is legal).
 */
describe('P61 — multi-recipient action behaviour', () => {
  it('duplicate guard names only the already-sent patients and still offers the rest', async () => {
    svc.recipients = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    svc.lastSent = new Date('2030-05-01T10:00:00Z');
    svc.lastSentIds = ['p2'];
    const r = await sendManualAppointmentMessageAction({
      appointmentId: 'a1',
      type: 'CONFIRMATION',
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data.needsConfirmation) throw new Error('expected a confirmation prompt');
    expect(r.data.alreadySent).toEqual([
      { patientId: 'p2', lastSentAt: '2030-05-01T10:00:00.000Z' },
    ]);
    expect(svc.sendCalls).toHaveLength(0);
  });

  it('passes the selected recipient ids through untouched', async () => {
    svc.recipients = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    await sendManualAppointmentMessageAction({
      appointmentId: 'a1',
      type: 'CONFIRMATION',
      recipientIds: ['p1', 'p3'],
    });
    expect(svc.sendCalls[0]).toMatchObject({ recipientIds: ['p1', 'p3'] });
  });

  it('reports a partial batch per patient with a localized reason', async () => {
    svc.recipients = [{ id: 'p1' }, { id: 'p2' }];
    svc.results = [
      { patientId: 'p1', ok: true, result: { jobId: 'job-1' } },
      { patientId: 'p2', ok: false, code: 'NO_PHONE' },
    ];
    const r = await sendManualAppointmentMessageAction({
      appointmentId: 'a1',
      type: 'CONFIRMATION',
    });
    expect(r.ok).toBe(true);
    if (!r.ok || r.data.needsConfirmation) throw new Error('expected a send result');
    expect(r.data).toMatchObject({ sentCount: 1, totalCount: 2 });
    expect(r.data.results[1]).toMatchObject({ patientId: 'p2', ok: false });
    expect(r.data.results[1]!.error?.message_ar).toContain('رقم هاتف');
  });

  it('a tampered recipient id is refused by the service and surfaced localized', async () => {
    svc.sendThrows = 'RECIPIENT_NOT_ON_APPOINTMENT';
    const r = await sendManualAppointmentMessageAction({
      appointmentId: 'a1',
      type: 'CONFIRMATION',
      recipientIds: ['not-mine'],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('RECIPIENT_NOT_ON_APPOINTMENT');
  });
});
