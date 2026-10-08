import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P62 — the internal "your patient has arrived" alert to the assigned
 * clinicians. Asserts: the approved `clinic_custom_message` frame carries
 * the alert ({{1}} = CLINICIAN first name, {{2}} = text in the clinician's
 * language), one message per clinician per arrival (an adjacent run lists
 * every time once), the owner's "no phone on file → no alert" rule, the
 * approval gate, the queue chokepoint, and that `whatsappReachable` is
 * ignored for staff.
 */

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn(async () => 'job-1') }));
const calls = () => enqueueMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({ enqueueWhatsappOutbound: enqueueMock }));
vi.mock('@/lib/time/clinic-server', () => ({
  getClinicTimeZone: vi.fn(async () => 'Asia/Amman'),
}));

vi.mock('@/lib/db', () => {
  const state = {
    patient: null as Record<string, unknown> | null,
    appointments: [] as Array<Record<string, unknown>>,
    approved: { AR: true, EN: true } as Record<string, boolean>,
    shape: ['patientName', 'customText'] as string[] | null,
  };
  return {
    __state: state,
    db: {
      user: { findUnique: vi.fn(async () => state.patient) },
      appointment: { findMany: vi.fn(async () => state.appointments) },
      whatsAppTemplate: {
        findUnique: vi.fn(async (args: { where: { name_language: { language: string } } }) => ({
          twilioApproved: state.approved[args.where.name_language.language] ?? false,
          variablesShape: state.shape,
        })),
      },
    },
  };
});

import { buildStaffArrivalText, sendStaffArrivalAlerts } from '../templates/sendStaffArrivalAlert';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    patient: Record<string, unknown> | null;
    appointments: Array<Record<string, unknown>>;
    approved: Record<string, boolean>;
    shape: string[] | null;
  };
};

// Amman is UTC+3 year-round: 07:00Z → 10:00, 07:30Z → 10:30.
const T1000 = new Date('2026-10-08T07:00:00.000Z');
const T1030 = new Date('2026-10-08T07:30:00.000Z');

const PATIENT = {
  fullNameEn: 'Sara Khalil',
  fullNameAr: 'سارة خليل',
  patientProfile: { gender: 'MALE' },
};
const RANA = {
  id: 'th-rana',
  phone: '+962779639133',
  languagePref: 'AR',
  fullNameEn: 'Rana Adeeb',
  fullNameAr: 'رنا أديب',
  deletedAt: null,
  whatsappReachable: true,
};
const HEBA_EN = {
  id: 'th-heba',
  phone: '+962790971608',
  languagePref: 'EN',
  fullNameEn: 'Heba Quqa',
  fullNameAr: 'هبة قوقا',
  deletedAt: null,
  whatsappReachable: true,
};
const NO_PHONE = { ...HEBA_EN, id: 'th-nophone', phone: null };

function appt(id: string, startsAt: Date, therapists: Array<Record<string, unknown>>) {
  return { id, startsAt, therapists: therapists.map((therapist) => ({ therapist })) };
}

beforeEach(() => {
  enqueueMock.mockClear();
  __state.patient = PATIENT;
  __state.appointments = [];
  __state.approved = { AR: true, EN: true };
  __state.shape = ['patientName', 'customText'];
});

describe('buildStaffArrivalText (pure)', () => {
  it('AR single time, male/unknown gender', () => {
    expect(
      buildStaffArrivalText({
        patientName: 'Sara Khalil',
        patientGender: null,
        times: ['10:00'],
        language: 'AR',
      }),
    ).toBe('وصل المريض Sara Khalil لموعده الساعة 10:00.');
  });

  it('AR female patient → feminine verb + pronoun', () => {
    expect(
      buildStaffArrivalText({
        patientName: 'Sara Khalil',
        patientGender: 'FEMALE',
        times: ['10:00', '10:30'],
        language: 'AR',
      }),
    ).toBe('وصلت المريضة Sara Khalil لمواعيدها الساعة 10:00 و10:30.');
  });

  it('EN single, two, and three times', () => {
    const base = { patientName: 'Omar Haddad', patientGender: null, language: 'EN' as const };
    expect(buildStaffArrivalText({ ...base, times: ['10:00'] })).toBe(
      'Your patient Omar Haddad has arrived for the 10:00 appointment.',
    );
    expect(buildStaffArrivalText({ ...base, times: ['10:00', '10:30'] })).toBe(
      'Your patient Omar Haddad has arrived for the 10:00 and 10:30 appointments.',
    );
    expect(buildStaffArrivalText({ ...base, times: ['10:00', '10:30', '11:00'] })).toBe(
      'Your patient Omar Haddad has arrived for the 10:00, 10:30 and 11:00 appointments.',
    );
  });

  it('no times → sentence without a time; duplicate times collapse', () => {
    expect(
      buildStaffArrivalText({ patientName: 'X', patientGender: null, times: [], language: 'EN' }),
    ).toBe('Your patient X has arrived.');
    expect(
      buildStaffArrivalText({
        patientName: 'X',
        patientGender: null,
        times: ['10:00', '10:00'],
        language: 'AR',
      }),
    ).toBe('وصل المريض X لموعده الساعة 10:00.');
  });
});

describe('sendStaffArrivalAlerts', () => {
  it('one appointment, one AR clinician → clinic_custom_message/AR greeting the CLINICIAN', async () => {
    __state.appointments = [appt('a1', T1000, [RANA])];
    const out = await sendStaffArrivalAlerts({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(calls()[0]![0]).toMatchObject({
      kind: 'template',
      templateName: 'clinic_custom_message',
      language: 'AR',
      // {{1}} = the clinician's first name, {{2}} = the alert text with the
      // clinic-wide (English-first) patient display name + clinic-wall time.
      parameters: ['رنا', 'وصل المريض Sara Khalil لموعده الساعة 10:00.'],
      recipientPhone: '+962779639133',
      recipientUserId: 'th-rana',
      appointmentId: 'a1',
      source: 'queue',
      sentById: null,
    });
    expect(out).toEqual([
      {
        jobId: 'job-1',
        templateName: 'clinic_custom_message',
        language: 'AR',
        recipientUserId: 'th-rana',
      },
    ]);
  });

  it('EN clinician → EN frame + English text', async () => {
    __state.appointments = [appt('a1', T1000, [HEBA_EN])];
    await sendStaffArrivalAlerts({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(calls()[0]![0]).toMatchObject({
      language: 'EN',
      parameters: ['Heba', 'Your patient Sara Khalil has arrived for the 10:00 appointment.'],
      recipientPhone: '+962790971608',
    });
  });

  it('back-to-back run with the same clinician → ONE message listing both times, anchored to the first', async () => {
    __state.appointments = [appt('a1', T1000, [RANA]), appt('a2', T1030, [RANA])];
    await sendStaffArrivalAlerts({ patientId: 'p1', appointmentIds: ['a2', 'a1'] });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(calls()[0]![0]).toMatchObject({
      parameters: ['رنا', 'وصل المريض Sara Khalil لمواعيده الساعة 10:00 و10:30.'],
      appointmentId: 'a1',
    });
  });

  it('two clinicians on one appointment → one message each, in their own language', async () => {
    __state.appointments = [appt('a1', T1000, [RANA, HEBA_EN])];
    await sendStaffArrivalAlerts({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    expect(
      calls()
        .map((c) => c[0]!.recipientUserId)
        .sort(),
    ).toEqual(['th-heba', 'th-rana']);
  });

  it('owner rule: a clinician with NO phone on file is skipped silently; the others still get theirs', async () => {
    __state.appointments = [appt('a1', T1000, [NO_PHONE, RANA])];
    await sendStaffArrivalAlerts({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(calls()[0]![0]).toMatchObject({ recipientUserId: 'th-rana' });
  });

  it('whatsappReachable=false is IGNORED for staff — the alert still goes out', async () => {
    __state.appointments = [appt('a1', T1000, [{ ...RANA, whatsappReachable: false }])];
    await sendStaffArrivalAlerts({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it('frame not approved for the clinician language → nothing enqueued (logged, ids only)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    __state.approved = { AR: false, EN: true };
    __state.appointments = [appt('a1', T1000, [RANA])];
    await sendStaffArrivalAlerts({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0]![0])).not.toMatch(/\+?\d{7,}/);
    errSpy.mockRestore();
  });

  it('deleted clinician row, missing patient, or no appointments → nothing', async () => {
    __state.appointments = [appt('a1', T1000, [{ ...RANA, deletedAt: new Date() }])];
    await sendStaffArrivalAlerts({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(enqueueMock).not.toHaveBeenCalled();

    __state.appointments = [appt('a1', T1000, [RANA])];
    __state.patient = null;
    await sendStaffArrivalAlerts({ patientId: 'gone', appointmentIds: ['a1'] });
    expect(enqueueMock).not.toHaveBeenCalled();

    __state.patient = PATIENT;
    await sendStaffArrivalAlerts({ patientId: 'p1', appointmentIds: [] });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('female patient → feminine Arabic wording', async () => {
    __state.patient = { ...PATIENT, patientProfile: { gender: 'FEMALE' } };
    __state.appointments = [appt('a1', T1000, [RANA])];
    await sendStaffArrivalAlerts({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(calls()[0]![0]).toMatchObject({
      parameters: ['رنا', 'وصلت المريضة Sara Khalil لموعدها الساعة 10:00.'],
    });
  });
});
