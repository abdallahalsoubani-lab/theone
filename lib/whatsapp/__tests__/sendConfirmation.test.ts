import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Amendment 46.1 regression net — the ONE shared confirmation sender used by
 * BOTH the single-booking path and the batch's earliest-row confirmation
 * (no duplicated message logic). Pins template selection by languagePref and
 * the skip rules, mirroring the sendRescheduled test harness.
 */

const { enqueueMock, linkMock, approvedMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(async () => 'job-1'),
  // P52 — the unused-intake-link lookup that flips the template.
  linkMock: vi.fn(async () => null as { token: string } | null),
  approvedMock: vi.fn(async () => true),
}));
const calls = () => enqueueMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({ enqueueWhatsappOutbound: enqueueMock }));
vi.mock('@/lib/intake-links/queries', () => ({ unusedLinkForAppointment: linkMock }));
vi.mock('@/lib/whatsapp/templates/approval', () => ({ isTemplateApproved: approvedMock }));
vi.mock('@/lib/time/clinic-server', () => ({
  getClinicTimeZone: vi.fn(async () => 'Asia/Amman'),
}));

vi.mock('@/lib/db', () => {
  const state = { appt: null as Record<string, unknown> | null };
  return {
    __state: state,
    db: {
      appointment: { findUnique: vi.fn(async () => state.appt) },
      whatsAppTemplate: { findUnique: vi.fn(async () => ({ variablesShape: null })) },
    },
  };
});

import { sendAppointmentConfirmation } from '../templates/sendConfirmation';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: { appt: Record<string, unknown> | null };
};

const THERAPIST = { therapist: { fullNameEn: 'Dr. Lina', fullNameAr: 'د. لينا' } };
const START = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function appt(patientOver: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'appt-1',
    startsAt: START,
    status: 'SCHEDULED',
    patient: {
      id: 'p1',
      phone: '+962790000001',
      languagePref: 'AR',
      whatsappReachable: true,
      fullNameEn: 'Sara Khalil',
      fullNameAr: 'سارة خليل',
      ...patientOver,
    },
    therapists: [THERAPIST],
  };
}

beforeEach(() => {
  enqueueMock.mockClear();
  linkMock.mockClear();
  linkMock.mockResolvedValue(null);
  approvedMock.mockClear();
  approvedMock.mockResolvedValue(true);
  __state.appt = null;
});

describe('sendAppointmentConfirmation', () => {
  it('AR patient → appointment_confirmation_v2 with language AR', async () => {
    __state.appt = appt();
    await sendAppointmentConfirmation({ appointmentId: 'appt-1' });
    expect(calls()[0]![0]).toMatchObject({
      kind: 'template',
      templateName: 'appointment_confirmation_v2',
      language: 'AR',
      recipientPhone: '+962790000001',
      appointmentId: 'appt-1',
    });
  });

  it('EN patient → same template, language EN', async () => {
    __state.appt = appt({ languagePref: 'EN' });
    await sendAppointmentConfirmation({ appointmentId: 'appt-1' });
    expect(calls()[0]![0]).toMatchObject({ language: 'EN' });
  });

  it('skips silently when unreachable / phone-less / cancelled meanwhile', async () => {
    __state.appt = appt({ whatsappReachable: false });
    await sendAppointmentConfirmation({ appointmentId: 'appt-1' });
    __state.appt = appt({ phone: null });
    await sendAppointmentConfirmation({ appointmentId: 'appt-1' });
    __state.appt = { ...appt(), status: 'CANCELLED' };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await sendAppointmentConfirmation({ appointmentId: 'appt-1' });
    warnSpy.mockRestore();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('P52 — combined new-patient confirmation template selection', () => {
  it('with an UNUSED intake link → the new_patient_confirmation template + the intake URL var', async () => {
    __state.appt = appt();
    linkMock.mockResolvedValue({ token: 'tok_abcdefghijklmnopqrstuvwxyz' });
    await sendAppointmentConfirmation({ appointmentId: 'appt-1' });
    const [job] = calls()[0]!;
    expect(job.templateName).toBe('new_patient_confirmation');
    // The 4th param (intakeUrl) is a URL that carries the token.
    const params = job.parameters as string[];
    expect(params[params.length - 1]).toContain('/intake/link/tok_abcdefghijklmnopqrstuvwxyz');
  });

  it('with NO link → the standard appointment_confirmation_v2 (regression)', async () => {
    __state.appt = appt();
    linkMock.mockResolvedValue(null);
    await sendAppointmentConfirmation({ appointmentId: 'appt-1' });
    expect(calls()[0]![0].templateName).toBe('appointment_confirmation_v2');
  });
});

describe('P52 deploy — new-patient confirmation approval fallback', () => {
  it('link present but combined template PENDING → standard confirmation, no link var', async () => {
    __state.appt = appt();
    linkMock.mockResolvedValue({ token: 'tok_pendingfallbackxxxxxxxxxx' });
    approvedMock.mockResolvedValue(false); // new_patient_confirmation not approved yet
    await sendAppointmentConfirmation({ appointmentId: 'appt-1' });
    const [job] = calls()[0]!;
    expect(job.templateName).toBe('appointment_confirmation_v2');
    // No intake URL leaks into the standard template params.
    expect((job.parameters as string[]).some((p) => p.includes('/intake/link/'))).toBe(false);
  });
});
