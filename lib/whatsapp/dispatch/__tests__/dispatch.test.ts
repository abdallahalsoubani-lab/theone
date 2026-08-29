import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P48 — dispatch control core (§6):
 *   AUTO delay / MANUAL outbox, last-state-wins with its two special cases,
 *   the manual batch send (per-type, idempotent), exclude, and the worker
 *   outcome flips. The dispatch SERVICE still never schedules/cancels P17
 *   reminder jobs (regression below) — but since P51 the reminder WORKERS
 *   deliberately consult the dispatch layer's silent-mode gate at fire
 *   time (owner-approved reversal, P51 §1.4; see silent-mode tests).
 *
 * The <24h safety exception was REMOVED on the owner's order (19 Aug 2026):
 * MANUAL now means nothing ever leaves without the admin's Send, however
 * close the appointment is. The old safety tests are UPDATED (not deleted)
 * to assert the reversed behaviour.
 */

// Pass-through, but capture each decorator config so tests can pin the audit
// events without loading the real withAudit (it pulls @/auth → next-auth).
const auditConfigs = vi.hoisted(
  () => [] as Array<{ extractAfter?: (r: never) => Record<string, unknown> }>,
);
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (cfg: (typeof auditConfigs)[number], fn: unknown) => {
    auditConfigs.push(cfg);
    return fn;
  },
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

// P51 — the outbox Send for held REMINDER/ARRIVAL/HOME_PROGRAM rows rides
// the queues directly (dynamic import in scheduleOutboxSend).
const queueAddMock = vi.hoisted(() =>
  vi.fn(async (_n: string, _d: unknown, o: { jobId: string }) => ({ id: o.jobId })),
);
const homeAddMock = vi.hoisted(() =>
  vi.fn(async (_n: string, _d: unknown, o: { jobId: string }) => ({ id: o.jobId })),
);
vi.mock('@/lib/queue/queues', () => ({
  reminderQueue: { add: queueAddMock, remove: vi.fn(async () => undefined) },
  homeProgramQueue: { add: homeAddMock, remove: vi.fn(async () => undefined) },
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
  homeProgramItemId?: string | null;
  createdAt: Date;
}
const state: {
  rows: Row[];
  settings: Record<string, unknown>;
  audits: Array<Record<string, unknown>>;
  appointments: Array<{ id: string; startsAt: Date; durationMinutes?: number; status?: string }>;
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
          homeProgramItemId: data.homeProgramItemId ?? null,
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

const { recordDispatchEvent, sendOutboxBatch, sendOutboxSingle, excludeDispatchEntry } =
  await import('../service');
const { markDispatchOutcome } = await import('../outcome');

const FUTURE_FAR = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // +3d
const FUTURE_NEAR = () => new Date(Date.now() + 2 * 60 * 60 * 1000); // +2h

const AUTO_SETTINGS = {
  whatsappSilentMode: false,
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

describe('sendOutboxSingle (P58 item 1)', () => {
  // Two held bookings + one held cancellation; single-send the first booking.
  async function seedThreeHeld() {
    state.settings = { ...MANUAL_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    await recordDispatchEvent({
      appointmentId: 'a2',
      patientId: 'p2',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    confirmationSentMock.mockResolvedValue(true);
    await recordDispatchEvent({
      appointmentId: 'a3',
      patientId: 'p3',
      startsAt: FUTURE_FAR(),
      type: 'CANCELLATION',
    });
    state.appointments = [
      { id: 'a1', startsAt: FUTURE_FAR() },
      { id: 'a2', startsAt: FUTURE_FAR() },
      { id: 'a3', startsAt: FUTURE_FAR() },
    ];
    scheduleMock.mockClear();
  }

  it('sends exactly the one entry; every other held row stays PENDING', async () => {
    await seedThreeHeld();
    const pendingBefore = state.rows.filter((r) => r.status === 'PENDING').length;
    expect(pendingBefore).toBe(3);

    const target = state.rows.find((r) => r.appointmentId === 'a1')!;
    const r = await sendOutboxSingle({ entryId: target.id, adminId: 'sec-1' });

    expect(r).toEqual({ entryId: target.id, sent: true, stale: false });
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: 'a1',
        kind: 'confirmation',
        delayMinutes: 0,
        adminSend: true,
      }),
    );
    expect(target).toMatchObject({
      status: 'SCHEDULED',
      dispatchReason: 'MANUAL',
      sentById: 'sec-1',
    });
    // The rest of the queue is untouched — same-type and other-type alike.
    expect(state.rows.filter((r2) => r2.status === 'PENDING')).toHaveLength(pendingBefore - 1);
    expect(state.rows.find((r2) => r2.appointmentId === 'a2')!.status).toBe('PENDING');
    expect(state.rows.find((r2) => r2.appointmentId === 'a3')!.status).toBe('PENDING');
  });

  it('goes out even while silent mode is ON — human-initiated, adminSend on the job', async () => {
    await seedThreeHeld();
    state.settings = { ...MANUAL_SETTINGS, whatsappSilentMode: true };

    const target = state.rows.find((r) => r.appointmentId === 'a1')!;
    const r = await sendOutboxSingle({ entryId: target.id, adminId: 'adm-1' });

    expect(r.sent).toBe(true);
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledWith(expect.objectContaining({ adminSend: true }));
    // One message out; the master switch itself was never written.
    expect(state.settings.whatsappSilentMode).toBe(true);
  });

  it('a stale row is refused: marked STALE, nothing sent', async () => {
    await seedThreeHeld();
    // The booking's appointment got cancelled after the entry parked —
    // the P51 staleness rule (time-independent branch).
    state.appointments = [
      { id: 'a1', startsAt: FUTURE_FAR(), status: 'CANCELLED' },
      { id: 'a2', startsAt: FUTURE_FAR() },
      { id: 'a3', startsAt: FUTURE_FAR() },
    ];

    const target = state.rows.find((r) => r.appointmentId === 'a1')!;
    const r = await sendOutboxSingle({ entryId: target.id, adminId: 'sec-1' });

    expect(r).toEqual({ entryId: target.id, sent: false, stale: true });
    expect(scheduleMock).not.toHaveBeenCalled();
    expect(target).toMatchObject({ status: 'STALE', failureReason: 'stale at send time' });
    // Everything else still held.
    expect(state.rows.filter((r2) => r2.status === 'PENDING')).toHaveLength(2);
  });

  it('rejects a non-pending entry', async () => {
    await seedThreeHeld();
    const target = state.rows.find((r) => r.appointmentId === 'a1')!;
    target.status = 'EXCLUDED';
    await expect(sendOutboxSingle({ entryId: target.id, adminId: 'sec-1' })).rejects.toThrow(
      'DISPATCH_ENTRY_NOT_PENDING',
    );
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('audits under its own event, distinct from the batch (OUTBOX_SEND_SINGLE)', () => {
    const events = auditConfigs
      .map((c) =>
        c.extractAfter?.({
          entryId: 'x',
          sent: true,
          stale: false,
          count: 1,
          entryIds: [],
          staleIds: [],
        } as never),
      )
      .filter(Boolean)
      .map((a) => (a as { event: string }).event);
    expect(events).toContain('OUTBOX_SEND_SINGLE');
    expect(events).toContain('OUTBOX_BATCH_SENT');
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

describe('P51 — silent mode (master hold-all switch)', () => {
  it('silent ON: an AUTO-mode booking parks PENDING with NO job (mode overridden)', async () => {
    state.settings = { ...AUTO_SETTINGS, whatsappSilentMode: true };
    const r = await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    expect(scheduleMock).not.toHaveBeenCalled();
    const row = state.rows.find((x) => x.id === r.entryId)!;
    expect(row.status).toBe('PENDING');
    expect(row.dispatchReason).toBeNull();
  });

  it('silent OFF: AUTO behaviour is byte-for-byte unchanged (regression)', async () => {
    state.settings = { ...AUTO_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it('the setting is read LIVE — a toggle between two events changes only the later one', async () => {
    state.settings = { ...AUTO_SETTINGS };
    await recordDispatchEvent({
      appointmentId: 'a1',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    state.settings = { ...AUTO_SETTINGS, whatsappSilentMode: true };
    await recordDispatchEvent({
      appointmentId: 'a2',
      patientId: 'p1',
      startsAt: FUTURE_FAR(),
      type: 'BOOKING_CONFIRMATION',
    });
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(state.rows.find((x) => x.appointmentId === 'a2')!.status).toBe('PENDING');
  });

  it('outbox Send of a held REMINDER rides the reminders queue with adminSend', async () => {
    state.rows.push({
      id: 'h1',
      type: 'REMINDER',
      status: 'PENDING',
      dispatchReason: null,
      appointmentId: 'a1',
      patientId: 'p1',
      supersededById: null,
      sentById: null,
      sentAt: null,
      failureReason: null,
      createdAt: new Date(),
    });
    state.appointments = [
      { id: 'a1', startsAt: FUTURE_NEAR(), durationMinutes: 60, status: 'SCHEDULED' },
    ];
    const res = await sendOutboxBatch({ type: 'REMINDER', adminId: 'adm-1' });
    expect(res.count).toBe(1);
    expect(queueAddMock).toHaveBeenCalledWith(
      'appointment',
      { appointmentId: 'a1', kind: 'reminder', adminSend: true },
      { jobId: 'outbox-reminder-a1' },
    );
    expect(state.rows[0]!.status).toBe('SCHEDULED');
    expect(state.rows[0]!.dispatchReason).toBe('MANUAL');
  });

  it('outbox Send of a held HOME_PROGRAM re-runs the home-reminder job', async () => {
    state.rows.push({
      id: 'h2',
      type: 'HOME_PROGRAM',
      status: 'PENDING',
      dispatchReason: null,
      appointmentId: null as unknown as string,
      patientId: 'p1',
      homeProgramItemId: 'item-9',
      supersededById: null,
      sentById: null,
      sentAt: null,
      failureReason: null,
      createdAt: new Date(),
    });
    const res = await sendOutboxBatch({ type: 'HOME_PROGRAM', adminId: 'adm-1' });
    expect(res.count).toBe(1);
    expect(homeAddMock).toHaveBeenCalledWith(
      'homeExerciseReminder',
      { itemId: 'item-9', adminSend: true },
      { jobId: 'outbox-homeprog-item-9' },
    );
  });

  it('§4.5 Send marks STALE rows, skips them, sends the rest, and audits the marking', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    state.rows.push(
      {
        id: 's1',
        type: 'REMINDER',
        status: 'PENDING',
        dispatchReason: null,
        appointmentId: 'a-past',
        patientId: 'p1',
        supersededById: null,
        sentById: null,
        sentAt: null,
        failureReason: null,
        createdAt: new Date(),
      },
      {
        id: 's2',
        type: 'REMINDER',
        status: 'PENDING',
        dispatchReason: null,
        appointmentId: 'a-future',
        patientId: 'p1',
        supersededById: null,
        sentById: null,
        sentAt: null,
        failureReason: null,
        createdAt: new Date(Date.now() + 1),
      },
    );
    state.appointments = [
      { id: 'a-past', startsAt: past, durationMinutes: 60, status: 'SCHEDULED' },
      { id: 'a-future', startsAt: FUTURE_NEAR(), durationMinutes: 60, status: 'SCHEDULED' },
    ];
    const res = await sendOutboxBatch({ type: 'REMINDER', adminId: 'adm-1' });
    expect(res.count).toBe(1);
    expect(res.staleIds).toEqual(['s1']);
    expect(state.rows.find((r) => r.id === 's1')!.status).toBe('STALE');
    expect(state.rows.find((r) => r.id === 's2')!.status).toBe('SCHEDULED');
    // withAudit is passthrough-mocked in this file; the audit payload is
    // covered by asserting the result the extractAfter config reads
    // (`staleIds` above) — the decorator itself is pinned in withAudit tests.
  });

  it('a held CANCELLATION for a long-past appointment is NOT stale — it still sends', async () => {
    const past = new Date(Date.now() - 10 * 60 * 60 * 1000);
    state.rows.push({
      id: 'c1',
      type: 'CANCELLATION',
      status: 'PENDING',
      dispatchReason: null,
      appointmentId: 'a-past',
      patientId: 'p1',
      supersededById: null,
      sentById: null,
      sentAt: null,
      failureReason: null,
      createdAt: new Date(),
    });
    state.appointments = [
      { id: 'a-past', startsAt: past, durationMinutes: 60, status: 'CANCELLED' },
    ];
    const res = await sendOutboxBatch({ type: 'CANCELLATION', adminId: 'adm-1' });
    expect(res.count).toBe(1);
    expect(res.staleIds).toEqual([]);
    // adminSend rides the lifecycle job so the fire-time gate lets it pass.
    expect(scheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'a-past', kind: 'cancellation', adminSend: true }),
    );
  });

  it('RBAC: Send actions gate on whatsapp.dispatch; the toggle on ADMIN-only whatsapp.silent_mode (P58)', async () => {
    // can.test.ts pins the matrix (P58: SECRETARY holds dispatch, only
    // ADMIN holds silent_mode); here we pin that the actions actually call
    // the guard with the right permission — the toggle must NOT ride the
    // dispatch permission the secretary now has.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'lib/whatsapp/dispatch/actions.ts'), 'utf8');
    const silentAction = src.slice(src.indexOf('export async function setSilentModeAction'));
    expect(silentAction).toContain("await requirePermission('whatsapp.silent_mode')");
    expect(silentAction).not.toContain("requirePermission('whatsapp.dispatch')");
    const sendAction = src.slice(src.indexOf('export async function sendOutboxAction'));
    expect(sendAction).toContain("await requirePermission('whatsapp.dispatch')");
    const singleAction = src.slice(src.indexOf('export async function sendOutboxSingleAction'));
    expect(singleAction).toContain("await requirePermission('whatsapp.dispatch')");
  });

  it('setSilentMode flips the setting and audits with the distinct event', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const { db } = await import('@/lib/db');
    (db.clinicSettings as unknown as { update: unknown }).update = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return {};
      },
    );
    const { setSilentMode } = await import('../service');
    await setSilentMode({ on: true, adminId: 'adm-1' });
    expect(updates[0]).toMatchObject({ whatsappSilentMode: true, updatedById: 'adm-1' });
  });
});

describe('reminder SCHEDULING stays out of the dispatch service (P51-updated regression)', () => {
  // P51 §1.4 deliberately reversed the "dispatch never touches reminders"
  // rule at FIRE time (workers consult the silent-mode gate). What must
  // still hold: the dispatch service never schedules, replaces, or cancels
  // P17 reminder JOBS — scheduling stays in lib/appointments.
  it('the dispatch service never imports the P17 reminder scheduling', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'lib/whatsapp/dispatch/service.ts'), 'utf8');
    expect(src).not.toContain('enqueueAppointmentReminder');
    expect(src).not.toContain('cancelAppointmentReminder');
    expect(src).not.toContain('reminderJobId');
  });
});
