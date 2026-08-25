import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P53 — the reminder worker renders ONE message per patient per clinic-day:
 * single_v3 for one appointment, multi (day summary) for two+. A GROUP fans
 * out per member with single_v3 (its own appointment only). No cancellation
 * sentence, no therapist name — that lives in the approved template text.
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
vi.mock('@/lib/time/clinic-server', () => ({ getClinicTimeZone: vi.fn(async () => 'Asia/Amman') }));

const state = {
  appt: null as Record<string, unknown> | null,
  sameDay: [] as Array<Record<string, unknown>>,
  enqueued: [] as Array<Record<string, unknown>>,
  v3Approved: true,
};

vi.mock('@/lib/db', () => ({
  db: {
    appointment: {
      findUnique: vi.fn(async () => state.appt),
      findMany: vi.fn(async () => state.sameDay),
    },
    // resolveTemplateShape reads the row's shape; null → LEGACY_SHAPES
    // (which now carries the v3 reminder shapes).
    whatsAppTemplate: {
      findUnique: vi.fn(async () => null),
      // P52/P53 — v3 approval gate; approved so the v3 path runs.
      findMany: vi.fn(async () => [
        { name: 'appointment_reminder_single_v3', twilioApproved: state.v3Approved },
        { name: 'appointment_reminder_multi', twilioApproved: state.v3Approved },
      ]),
    },
  },
}));
vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({
  enqueueWhatsappOutbound: vi.fn(async (job: Record<string, unknown>) => {
    state.enqueued.push(job);
    return 'enq';
  }),
}));

import { startReminderWorker } from '../reminder';

const patient = {
  id: 'p1',
  fullNameEn: 'Sara',
  fullNameAr: 'سارة',
  phone: '+962790000001',
  languagePref: 'EN' as const,
};
// 08:00Z = 11:00 AM Amman, 10:00Z = 1:00 PM, 11:00Z = 2:00 PM.
const D = (iso: string) => new Date(iso);
function appt(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1',
    startsAt: D('2030-05-10T08:00:00Z'),
    durationMinutes: 60,
    status: 'SCHEDULED',
    appointmentType: 'SESSION',
    patientId: 'p1',
    patient,
    groupPatients: [],
    therapists: [],
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  state.appt = null;
  state.sameDay = [];
  state.enqueued = [];
  state.v3Approved = true;
  startReminderWorker();
});

describe('reminder worker — day grouping + template selection', () => {
  it('one appointment that day → single_v3, {{1}} is the start time', async () => {
    state.appt = appt();
    state.sameDay = [{ id: 'a1', startsAt: D('2030-05-10T08:00:00Z'), durationMinutes: 60 }];
    await processor!({ data: { appointmentId: 'a1' } });
    expect(state.enqueued).toHaveLength(1);
    expect(state.enqueued[0]!.templateName).toBe('appointment_reminder_single_v3');
    expect(state.enqueued[0]!.parameters).toEqual([expect.stringMatching(/11:00\s?AM/i)]);
  });

  it('two same-day appointments → ONE message, multi template', async () => {
    state.appt = appt();
    state.sameDay = [
      { id: 'a1', startsAt: D('2030-05-10T08:00:00Z'), durationMinutes: 60, therapists: [] },
      { id: 'a2', startsAt: D('2030-05-10T10:00:00Z'), durationMinutes: 60, therapists: [] },
    ];
    await processor!({ data: { appointmentId: 'a1' } });
    expect(state.enqueued).toHaveLength(1);
    expect(state.enqueued[0]!.templateName).toBe('appointment_reminder_multi');
    // Two spaced → labelled entries, both start times, no end times.
    const body = (state.enqueued[0]!.parameters as string[])[0]!;
    expect(body).toMatch(/Appointment 1: at 11:00\s?AM/i);
    expect(body).toMatch(/Appointment 2: at 1:00\s?PM/i);
  });

  it('two ADJACENT same-day appointments → multi template rendered as one range', async () => {
    state.appt = appt();
    state.sameDay = [
      { id: 'a1', startsAt: D('2030-05-10T08:00:00Z'), durationMinutes: 60, therapists: [] }, // 11–12
      { id: 'a2', startsAt: D('2030-05-10T09:00:00Z'), durationMinutes: 60, therapists: [] }, // 12–1
    ];
    await processor!({ data: { appointmentId: 'a1' } });
    expect(state.enqueued).toHaveLength(1);
    expect(state.enqueued[0]!.templateName).toBe('appointment_reminder_multi');
    expect((state.enqueued[0]!.parameters as string[])[0]).toMatch(/from 11:00\s?AM to 1:00\s?PM/i);
  });

  it('a GROUP reminder fans out per member with single_v3 (its own time only)', async () => {
    const m2 = { ...patient, id: 'p2', fullNameEn: 'Omar' };
    state.appt = appt({
      appointmentType: 'GROUP',
      patientId: null,
      patient: null,
      groupPatients: [{ patient }, { patient: m2 }],
    });
    await processor!({ data: { appointmentId: 'a1' } });
    expect(state.enqueued).toHaveLength(2);
    for (const e of state.enqueued) {
      expect(e.templateName).toBe('appointment_reminder_single_v3');
    }
    // The worker never queried same-day for a group (its own appt only).
  });
});

describe('P52/P53 deploy — v3 pending → v2 per appointment (no regression)', () => {
  it('two same-day appointments, v3 PENDING → TWO v2 messages (one per appointment)', async () => {
    state.v3Approved = false;
    state.appt = appt();
    state.sameDay = [
      { id: 'a1', startsAt: D('2030-05-10T08:00:00Z'), durationMinutes: 60, therapists: [] },
      { id: 'a2', startsAt: D('2030-05-10T10:00:00Z'), durationMinutes: 60, therapists: [] },
    ];
    await processor!({ data: { appointmentId: 'a1' } });
    // Old behaviour exactly: one legacy reminder per appointment.
    expect(state.enqueued).toHaveLength(2);
    for (const e of state.enqueued) {
      expect(e.templateName).toBe('appointment_reminder_v2');
    }
    expect(state.enqueued.map((e) => e.appointmentId).sort()).toEqual(['a1', 'a2']);
  });

  it('one appointment, v3 PENDING → one v2 message', async () => {
    state.v3Approved = false;
    state.appt = appt();
    state.sameDay = [
      { id: 'a1', startsAt: D('2030-05-10T08:00:00Z'), durationMinutes: 60, therapists: [] },
    ];
    await processor!({ data: { appointmentId: 'a1' } });
    expect(state.enqueued).toHaveLength(1);
    expect(state.enqueued[0]!.templateName).toBe('appointment_reminder_v2');
  });
});
