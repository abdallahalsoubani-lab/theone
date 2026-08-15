import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 48 — the reschedule message funnel. Asserts the approved 4-variable
 * contract ({{1}} patient, {{2}} date, {{3}} time, {{4}} clinician), clinic
 * wall-time formatting, per-recipient language, the documented display
 * decisions (first therapist / stretching label / GROUP fan-out), and the
 * skip rules (unreachable, patient-less EVENT).
 */

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn(async () => 'job-1') }));
const calls = () => enqueueMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({ enqueueWhatsappOutbound: enqueueMock }));
vi.mock('@/lib/time/clinic-server', () => ({
  getClinicTimeZone: vi.fn(async () => 'Asia/Amman'),
}));

vi.mock('@/lib/db', () => {
  const state = { appt: null as Record<string, unknown> | null };
  return {
    __state: state,
    db: {
      appointment: { findUnique: vi.fn(async () => state.appt) },
      // 48b: shape resolution — null → legacy P48 order (the pinned contract).
      whatsAppTemplate: { findUnique: vi.fn(async () => ({ variablesShape: null })) },
    },
  };
});

import { sendAppointmentRescheduled } from '../templates/sendRescheduled';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: { appt: Record<string, unknown> | null };
};

const AR_PATIENT = {
  id: 'p1',
  phone: '+962790000001',
  languagePref: 'AR',
  whatsappReachable: true,
  fullNameEn: 'Sara Khalil',
  fullNameAr: 'سارة خليل',
};
const EN_PATIENT = {
  id: 'p2',
  phone: '+962790000002',
  languagePref: 'EN',
  whatsappReachable: true,
  fullNameEn: 'Omar Ziad',
  fullNameAr: 'عمر زياد',
};
const THERAPIST = { therapist: { fullNameEn: 'Dr. Lina', fullNameAr: 'د. لينا' } };

// 2026-08-01T13:30Z = 16:30 Asia/Amman.
const START = new Date('2026-08-01T13:30:00Z');

function baseAppt(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'appt-1',
    startsAt: START,
    // P53: the deferred sender skips terminal appointments — fixtures are
    // live bookings.
    status: 'SCHEDULED',
    appointmentType: 'SESSION',
    patient: AR_PATIENT,
    groupPatients: [],
    therapists: [THERAPIST],
    ...over,
  };
}

beforeEach(() => {
  enqueueMock.mockClear();
  __state.appt = baseAppt();
});

describe('sendAppointmentRescheduled — 4-variable contract', () => {
  it('AR patient: [name, date, time, clinician] in clinic wall time, AR names', async () => {
    await sendAppointmentRescheduled({ appointmentId: 'appt-1' });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'appointment_rescheduled',
        language: 'AR',
        // P47 row 8 — the patient-name variable is the English display name.
        parameters: ['Sara Khalil', '2026-08-01', '16:30', 'د. لينا'],
        recipientPhone: '+962790000001',
        appointmentId: 'appt-1',
      }),
    );
  });

  it('EN patient: EN names, same clinic-TZ date/time', async () => {
    __state.appt = baseAppt({ patient: EN_PATIENT });
    await sendAppointmentRescheduled({ appointmentId: 'appt-1' });
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'EN',
        parameters: ['Omar Ziad', '2026-08-01', '16:30', 'Dr. Lina'],
      }),
    );
  });

  it('multi-therapist: names the FIRST assigned clinician (confirmation convention)', async () => {
    __state.appt = baseAppt({
      therapists: [THERAPIST, { therapist: { fullNameEn: 'Dr. B', fullNameAr: 'د. ب' } }],
    });
    await sendAppointmentRescheduled({ appointmentId: 'appt-1' });
    expect(calls()[0]![0]).toMatchObject({
      // P47 row 8 — the patient-name variable is the English display name.
      parameters: ['Sara Khalil', '2026-08-01', '16:30', 'د. لينا'],
    });
  });

  it('STRETCHING (no therapist): clinician slot reads the stretching label', async () => {
    __state.appt = baseAppt({ appointmentType: 'STRETCHING', therapists: [] });
    await sendAppointmentRescheduled({ appointmentId: 'appt-1' });
    expect(calls()[0]![0]).toMatchObject({
      // P47 row 8 — the patient-name variable is the English display name.
      parameters: ['Sara Khalil', '2026-08-01', '16:30', 'جلسة استطالة'],
    });
  });

  it('GROUP: fans out to every member in their own language', async () => {
    __state.appt = baseAppt({
      appointmentType: 'GROUP',
      patient: null,
      groupPatients: [{ patient: AR_PATIENT }, { patient: EN_PATIENT }],
    });
    await sendAppointmentRescheduled({ appointmentId: 'appt-1' });
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    const langs = calls().map((c) => (c[0] as { language: string }).language);
    expect(langs.sort()).toEqual(['AR', 'EN']);
  });

  it('skips unreachable patients; patient-less EVENT sends nothing', async () => {
    __state.appt = baseAppt({ patient: { ...AR_PATIENT, whatsappReachable: false } });
    await sendAppointmentRescheduled({ appointmentId: 'appt-1' });
    expect(enqueueMock).not.toHaveBeenCalled();

    __state.appt = baseAppt({ appointmentType: 'EVENT', patient: null, groupPatients: [] });
    await sendAppointmentRescheduled({ appointmentId: 'appt-1' });
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('seed registry matches the APPROVED v2 bodies (P54 switch)', () => {
  it('reference-data.ts carries the 4-var DAY-NAME bodies in both languages for appointment_rescheduled', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('prisma/seed/reference-data.ts', 'utf8');
    expect(src).toContain(
      'Hi {{1}}, your appointment has been moved to {{2}}, {{3}} at {{4}}. See you then.',
    );
    expect(src).toContain(
      'مرحباً {{1}}، تم تغيير موعدكم إلى يوم {{2}} الموافق {{3}} الساعة {{4}}. نراكم قريباً.',
    );
  });
});
