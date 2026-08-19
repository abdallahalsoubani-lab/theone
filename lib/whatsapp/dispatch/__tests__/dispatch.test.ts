import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P48 — dispatch control core (§6):
 *   AUTO delay / MANUAL outbox, last-state-wins with its two special cases,
 *   the manual batch send (per-type, idempotent), exclude, and the worker
 *   outcome flips. The P17 reminder pipeline is untouched — nothing here
 *   imports or calls it (regression: see assertion below).
 *
 * The <24h safety exception was REMOVED on the owner's order (19 Aug 2026):
 * MANUAL now means nothing ever leaves without the admin's Send, however
 * close the appointment is. The old safety tests are UPDATED (not deleted)
 * to assert the reversed behaviour.
 */

vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_cfg: unknown, fn: unknown) => fn,
}));
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => ({
    user: { id: 'sec-1', role: 'SECRETARY' },
    isImpersonating: false,
  })),
}));

const scheduleMock = vi.hoisted(() => vi.fn(async () => 'job-1'));
const cancelJobsMock = vi.hoisted(() => vi.fn(async () => ({ confirmWasPending: false })));
vi.mock('@/lib/queue/jobs/appointmentReminder', () => ({
  scheduleLifecycleMessage: scheduleMock,
  cancelLifecycleMessages: cancelJobsMock,
}));

const confirmationSentMock = vi.hoisted(() => vi.fn(async () => false));
vi.mock('@/lib/whatsapp/templates/sendConfirmation', () => ({
  confirmationAlreadySent: confirmationSentMock,
}));

interface Row {
  id: string;
  type: string;
  status: string;
  dispatchReason: string | null;
  appointmentId: string;
  patientId: string | null;
  supersededById: string | null;
  sentById: string | null;
  sentAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
}
const state: {
  rows: Row[];
  settings: Record<string, unknown>;
  audits: Array<Record<string, unknown>>;
  appointments: Array<{ id: string; startsAt: Date }>;
} = { rows: [], settings: {}, audits: [], appointments: [] };
let seq = 0;

vi.mock('@/lib/db', () => ({
  db: {
    clinicSettings: { findUnique: vi.fn(async () => state.settings) },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.audits.push(data);
        return {};
      }),
    },
    appointment: {
      findMany: vi.fn(async () => state.appointments),
    },
    whatsAppDispatch: {
      findMany: vi.fn(
        async ({ where }: { where: { appointmentId?: string; status?: unknown; type?: string } }) =>
          state.rows.filter(
            (r) =>
              (!where.appointmentId || r.appointmentId === where.appointmentId) &&
              (!where.type || r.type === where.type) &&
              (where.status === undefined ||
                (typeof where.status === 'string'
                  ? r.status === where.status
                  : (where.status as { in: string[] }).in.includes(r.status))),
          ),
      ),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { appointmentId?: string; type?: string; status?: string; id?: string };
        }) =>
          state.rows
            .filter(
              (r) =>
                (!where.appointmentId || r.appointmentId === where.appointmentId) &&
                (!where.type || r.type === where.type) &&
                (!where.status || r.status === where.status) &&
                (!where.id || r.id === where.id),
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          state.rows.find((r) => r.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        const row: Row = {
          id: `d${++seq}`,
          type: data.type!,
          status: data.status ?? 'PENDING',
          dispatchReason: data.dispatchReason ?? null,
          appointmentId: data.appointmentId!,
          patientId: data.patientId ?? null,
          supersededById: null,
          sentById: null,
          sentAt: null,
          failureReason: null,
          createdAt: new Date(Date.now() + seq),
        };
        state.rows.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = state.rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: { in: string[] } }; data: Partial<Row> }) => {
          for (const r of state.rows.filter((x) => where.id.in.includes(x.id))) {
            Object.assign(r, data);
          }
          return { count: where.id.in.length };
        },
      ),
      count: vi.fn(async () => state.rows.filter((r) => r.status === 'PENDING').length),
    },
  },
  toLocalizedError: (e: unknown) => e,
}));

const { recordDispatchEvent, sendOutboxBatch, excludeDispatchEntry } = await import('../service');
const { markDispatchOutcome } = await import('../outcome');

const FUTURE_FAR = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // +3d
const FUTURE_NEAR = () => new Date(Date.now() + 2 * 60 * 60 * 1000); // +2h

const AUTO_SETTINGS = {
  bookingDispatchMode: 'AUTO',
  rescheduleDispatchMode: 'AUTO',
  cancellationDispatchMode: 'AUTO',
  bookingConfirmationDelayMinutes: 300,
  rescheduleMessageDelayMinutes: 300,
  cancellationMessageDelayMinutes: 0,
};
const MANUAL_SETTINGS = {
  ...AUTO_SETTINGS,
  bookingDispatchMode: 'MANUAL',
  rescheduleDispatchMode: 'MANUAL',
  cancellationDispatchMode: 'MANUAL',
};

beforeEach(() => {
  state.rows = [];
  state.audits = [];
  state.appointments = [];
  state.settings = { ...AUTO_SETTINGS };
  seq = 0;
  scheduleMock.mockClear();
  cancelJobsMock.mockClear();
  cancelJobsMock.mockResolvedValue({ confirmWasPending: false });
  confirmationSentMock.mockClear();
  confirmationSentMock.mockResolvedValue(false);
});

describe('recordDispatchEvent — modes (§4.1)', () => {
  it('AUTO schedules the deferred job with the configured delay; entry SCHEDULED/AUTO', async () => {
    const r = await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    expect(r.entryId).toBeTruthy();
    expect(scheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'a1', kind: 'confirmation', delayMinutes: 300 }),
    );
    expect(state.rows[0]).toMatchObject({ status: 'SCHEDULED', dispatchReason: 'AUTO' });
  });

  it('AUTO with delay 0 still enqueues (immediately)', async () => {
    state.settings = { ...AUTO_SETTINGS, bookingConfirmationDelayMinutes: 0 };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    expect(scheduleMock).toHaveBeenCalledWith(expect.objectContaining({ delayMinutes: 0 }));
  });

  it('MANUAL parks the entry PENDING with no job', async () => {
    state.settings = { ...MANUAL_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    expect(scheduleMock).not.toHaveBeenCalled();
    expect(state.rows[0]).toMatchObject({ status: 'PENDING', dispatchReason: null });
  });

  it('<24h start STAYS PENDING in MANUAL — the safety exception is gone (owner order 19 Aug)', async () => {
    state.settings = { ...MANUAL_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_NEAR(),
      type: 'CANCELLATION',
    });
    // Nothing leaves without the admin's Send, however close the start is.
    expect(scheduleMock).not.toHaveBeenCalled();
    expect(state.rows[0]).toMatchObject({ status: 'PENDING', dispatchReason: null });
    expect(state.audits.some((a) => JSON.stringify(a).includes('SAFETY_EXCEPTION'))).toBe(false);
  });

  it('<24h start in AUTO still sends with the configured delay (mode decides alone)', async () => {
    state.settings = { ...AUTO_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_NEAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    expect(scheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'confirmation', delayMinutes: 300 }),
    );
    expect(state.rows[0]).toMatchObject({ status: 'SCHEDULED', dispatchReason: 'AUTO' });
  });

  it('start ≥ 24h away obeys MANUAL (unchanged)', async () => {
    state.settings = { ...MANUAL_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'CANCELLATION',
    });
    expect(scheduleMock).not.toHaveBeenCalled();
    expect(state.rows[0]).toMatchObject({ status: 'PENDING' });
  });
});

describe('last-state-wins (§4.2)', () => {
  it('booking → reschedule before send = ONE fresh confirmation, old entry SUPERSEDED', async () => {
    state.settings = { ...MANUAL_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'RESCHEDULE',
    });
    const [first, second] = state.rows;
    expect(first).toMatchObject({ status: 'SUPERSEDED', supersededById: second!.id });
    // Re-issued as a CONFIRMATION (the patient's first notice), not a reschedule.
    expect(second).toMatchObject({ type: 'BOOKING_CONFIRMATION', status: 'PENDING' });
  });

  it('booking → cancel before send = nothing sent, both closed (silent close)', async () => {
    state.settings = { ...MANUAL_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    const r = await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'CANCELLATION',
    });
    expect(r.suppressed).toBe('SILENT_CLOSE');
    expect(r.entryId).toBeNull();
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ status: 'SUPERSEDED' });
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('booking → reschedule → cancel = exactly one CANCELLATION once the confirmation was SENT', async () => {
    // The confirmation actually went out earlier:
    confirmationSentMock.mockResolvedValue(true);
    state.settings = { ...MANUAL_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'RESCHEDULE',
    });
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'CANCELLATION',
    });
    const open = state.rows.filter((r) => r.status === 'PENDING');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ type: 'CANCELLATION' });
    expect(state.rows.filter((r) => r.status === 'SUPERSEDED')).toHaveLength(1);
  });

  it('notify=false supersedes open entries but creates nothing', async () => {
    state.settings = { ...MANUAL_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    const r = await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'CANCELLATION',
      notify: false,
    });
    expect(r.suppressed).toBe('NOTIFY_OFF');
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.status).toBe('SUPERSEDED');
  });
});

describe('sendOutboxBatch (§4.3)', () => {
  it('sends only the pressed type; other types stay pending; second press is a no-op', async () => {
    state.settings = { ...MANUAL_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    confirmationSentMock.mockResolvedValue(true);
    await recordDispatchEvent({
      appointmentId: 'a2',
      patientId: 'p2',
      startsAt: FUTURE_FAR(),
      type: 'CANCELLATION',
    });
    state.appointments = [
      { id: 'a1', startsAt: FUTURE_FAR() },
      { id: 'a2', startsAt: FUTURE_FAR() },
    ];
    scheduleMock.mockClear();

    const r1 = await sendOutboxBatch({ type: 'BOOKING_CONFIRMATION', adminId: 'admin-1' });
    expect(r1.count).toBe(1);
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'a1', kind: 'confirmation', delayMinutes: 0 }),
    );
    const booking = state.rows.find((r) => r.appointmentId === 'a1')!;
    expect(booking).toMatchObject({
      status: 'SCHEDULED',
      dispatchReason: 'MANUAL',
      sentById: 'admin-1',
    });
    // The cancellation batch was untouched.
    expect(state.rows.find((r) => r.appointmentId === 'a2')!.status).toBe('PENDING');

    const r2 = await sendOutboxBatch({ type: 'BOOKING_CONFIRMATION', adminId: 'admin-1' });
    expect(r2.count).toBe(0);
  });

  it('an EXCLUDED entry is not sent by the batch', async () => {
    state.settings = { ...MANUAL_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    const entryId = state.rows[0]!.id;
    await excludeDispatchEntry({ entryId, adminId: 'admin-1' });
    expect(state.rows[0]!.status).toBe('EXCLUDED');

    const r = await sendOutboxBatch({ type: 'BOOKING_CONFIRMATION', adminId: 'admin-1' });
    expect(r.count).toBe(0);
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('exclude rejects a non-pending entry', async () => {
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    }); // AUTO → SCHEDULED
    await expect(
      excludeDispatchEntry({ entryId: state.rows[0]!.id, adminId: 'admin-1' }),
    ).rejects.toThrow('DISPATCH_ENTRY_NOT_PENDING');
  });
});

describe('markDispatchOutcome (worker callback)', () => {
  it('flips the SCHEDULED entry to SENT / FAILED', async () => {
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    await markDispatchOutcome({ appointmentId: 'a1', kind: 'confirmation', ok: true });
    expect(state.rows[0]!.status).toBe('SENT');
    expect(state.rows[0]!.sentAt).toBeInstanceOf(Date);

    await recordDispatchEvent({
      appointmentId: 'a2',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    await markDispatchOutcome({
      appointmentId: 'a2',
      kind: 'confirmation',
      ok: false,
      error: 'provider down',
    });
    expect(state.rows.find((r) => r.appointmentId === 'a2')).toMatchObject({
      status: 'FAILED',
      failureReason: 'provider down',
    });
  });
});

describe('reminder pipeline untouched (regression)', () => {
  it('the dispatch layer never imports or calls the P17 reminder scheduling', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'lib/whatsapp/dispatch/service.ts'), 'utf8');
    expect(src).not.toContain('enqueueAppointmentReminder');
    expect(src).not.toContain('cancelAppointmentReminder');
    expect(src).not.toContain('reminderJobId');
  });
});
