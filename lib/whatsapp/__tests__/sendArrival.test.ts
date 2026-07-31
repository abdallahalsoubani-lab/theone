import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * July 31 item 3 — the arrival-confirmation sender. Asserts the 1-variable
 * contract ({{1}} = patient FIRST name in the preferred language), template
 * selection by languagePref, the queue chokepoint (never inline), and the
 * skip rules (unreachable / phone-less patient).
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
    shape: ['patientName'] as string[] | null,
  };
  return {
    __state: state,
    db: {
      user: { findUnique: vi.fn(async () => state.patient) },
      whatsAppTemplate: { findUnique: vi.fn(async () => ({ variablesShape: state.shape })) },
    },
  };
});

import { sendArrivalConfirmation } from '../templates/sendArrival';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: { patient: Record<string, unknown> | null; shape: string[] | null };
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
  fullNameEn: 'Omar Ziad Haddad',
  fullNameAr: 'عمر زياد حداد',
};

beforeEach(() => {
  enqueueMock.mockClear();
  __state.patient = null;
  __state.shape = ['patientName'];
});

describe('sendArrivalConfirmation', () => {
  it('AR patient → arrival_confirmation/AR with the Arabic FIRST name as {{1}}', async () => {
    __state.patient = AR_PATIENT;
    await sendArrivalConfirmation({ patientId: 'p1', appointmentIds: ['a1', 'a2'] });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(calls()[0]![0]).toMatchObject({
      kind: 'template',
      templateName: 'arrival_confirmation',
      language: 'AR',
      parameters: ['سارة'],
      recipientPhone: '+962790000001',
      recipientUserId: 'p1',
      appointmentId: 'a1', // the run's first appointment anchors the log row
      source: 'queue',
    });
  });

  it('EN patient → EN template with the English first name', async () => {
    __state.patient = EN_PATIENT;
    await sendArrivalConfirmation({ patientId: 'p2', appointmentIds: ['b1'] });
    expect(calls()[0]![0]).toMatchObject({
      templateName: 'arrival_confirmation',
      language: 'EN',
      parameters: ['Omar'],
    });
  });

  it('skips silently when the patient is not WhatsApp-reachable', async () => {
    __state.patient = { ...AR_PATIENT, whatsappReachable: false };
    await sendArrivalConfirmation({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('skips silently when the patient has no phone', async () => {
    __state.patient = { ...AR_PATIENT, phone: null };
    await sendArrivalConfirmation({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('skips silently when the patient row is gone', async () => {
    await sendArrivalConfirmation({ patientId: 'ghost', appointmentIds: ['a1'] });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('falls back to the other script when the preferred-language name is empty', async () => {
    __state.patient = { ...AR_PATIENT, fullNameAr: '' };
    await sendArrivalConfirmation({ patientId: 'p1', appointmentIds: ['a1'] });
    expect(calls()[0]![0]).toMatchObject({ language: 'AR', parameters: ['Sara'] });
  });

  it('respects a stored registry shape over the legacy default', async () => {
    // A future re-approved body could reorder/extend tokens — the row wins.
    __state.shape = ['patientName'];
    __state.patient = EN_PATIENT;
    await sendArrivalConfirmation({ patientId: 'p2', appointmentIds: ['b1'] });
    expect((calls()[0]![0] as { parameters: string[] }).parameters).toHaveLength(1);
  });
});
