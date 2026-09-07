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
  sendCalls: [] as Array<Record<string, unknown>>,
  sendThrows: null as string | null,
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
    lastSentOfType: vi.fn(async () => svc.lastSent),
    sendManualAppointmentMessage: vi.fn(async (args: Record<string, unknown>) => {
      if (svc.sendThrows) throw new ManualSendError(svc.sendThrows);
      svc.sendCalls.push(args);
      return {
        appointmentId: 'a1',
        type: args.type,
        jobId: 'job-1',
        templateName: 'appointment_confirmation_v2',
        language: 'AR',
        sentAt: new Date('2030-05-10T08:00:00Z'),
        resend: args.resend,
        closedDispatch: 0,
      };
    }),
    getManualMessageOptions: vi.fn(async () => ({
      hasPatient: true,
      hasPhone: true,
      language: 'AR',
      patientFirstName: 'سارة',
      customFrame: null,
      customApproved: false,
      options: [
        { type: 'CONFIRMATION', preview: 'p', lastSentAt: new Date('2030-05-01T10:00:00Z') },
      ],
    })),
  };
});

import { getManualMessageOptionsAction, sendManualAppointmentMessageAction } from '../actions';

beforeEach(() => {
  permission.user = { id: 'sec-1', role: 'SECRETARY' };
  svc.lastSent = null;
  svc.sendCalls = [];
  svc.sendThrows = null;
});

describe('sendManualAppointmentMessageAction', () => {
  it('first send of a type goes straight through with resend=false and the acting user', async () => {
    const r = await sendManualAppointmentMessageAction({
      appointmentId: 'a1',
      type: 'CONFIRMATION',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ needsConfirmation: false, jobId: 'job-1', language: 'AR' });
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
    expect(r.data).toEqual({ needsConfirmation: true, lastSentAt: '2030-05-01T10:00:00.000Z' });
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
      preview: 'p',
      lastSentAt: '2030-05-01T10:00:00.000Z',
    });
  });
});
