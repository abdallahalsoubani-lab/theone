import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock, staffMock, silentMock, holdMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async () => undefined),
  staffMock: vi.fn(async () => []),
  silentMock: vi.fn(async () => false),
  holdMock: vi.fn(async () => 'held-1'),
}));
vi.mock('@/lib/whatsapp/templates/sendArrival', () => ({ sendArrivalConfirmation: sendMock }));
// P62 — the staff half of the seam (internal alert to the assigned clinicians).
vi.mock('@/lib/whatsapp/templates/sendStaffArrivalAlert', () => ({
  sendStaffArrivalAlerts: staffMock,
}));
// P51 — the silent-mode gate sits in front of the sender; OFF by default so
// the pre-P51 tests pin today's behaviour unchanged.
vi.mock('@/lib/whatsapp/silent-mode', () => ({
  isSilentModeOn: silentMock,
  holdForOutbox: holdMock,
}));

import { notifyArrival } from '../notify-arrival';

describe('notifyArrival (July 31 item 3 — failure isolation)', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue(undefined);
    staffMock.mockReset();
    staffMock.mockResolvedValue([]);
    silentMock.mockReset();
    silentMock.mockResolvedValue(false);
    holdMock.mockClear();
  });

  it('delegates to the arrival sender with the arrival group', async () => {
    await notifyArrival('pat-1', ['a', 'b']);
    expect(sendMock).toHaveBeenCalledWith({ patientId: 'pat-1', appointmentIds: ['a', 'b'] });
  });

  it('swallows sender failures — a messaging problem never fails the check-in', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMock.mockRejectedValue(new Error('redis down'));
    await expect(notifyArrival('pat-1', ['a'])).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    // Redaction: the log line carries ids only.
    expect(String(errSpy.mock.calls[0]![0])).not.toMatch(/\+?\d{7,}/);
    errSpy.mockRestore();
  });
});

describe('P51 — silent mode holds the arrival instead of sending', () => {
  beforeEach(() => {
    sendMock.mockReset();
    staffMock.mockReset();
    staffMock.mockResolvedValue([]);
    holdMock.mockClear();
    silentMock.mockReset();
    silentMock.mockResolvedValue(true);
  });

  it('silent ON → held ARRIVAL row anchored to the run first appointment; sender never called', async () => {
    await notifyArrival('pat-1', ['a', 'b']);
    expect(sendMock).not.toHaveBeenCalled();
    expect(holdMock).toHaveBeenCalledWith({
      type: 'ARRIVAL',
      appointmentId: 'a',
      patientId: 'pat-1',
    });
  });

  it('a hold failure is swallowed like a send failure — check-in never breaks', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    holdMock.mockRejectedValue(new Error('db down'));
    await expect(notifyArrival('pat-1', ['a'])).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('P62 — the staff half: internal alert to the assigned clinicians', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue(undefined);
    staffMock.mockReset();
    staffMock.mockResolvedValue([]);
    silentMock.mockReset();
    silentMock.mockResolvedValue(false);
    holdMock.mockClear();
  });

  it('fires once per arrival with the same group the patient message gets', async () => {
    await notifyArrival('pat-1', ['a', 'b']);
    expect(staffMock).toHaveBeenCalledTimes(1);
    expect(staffMock).toHaveBeenCalledWith({ patientId: 'pat-1', appointmentIds: ['a', 'b'] });
  });

  it('owner decision: silent mode ON still alerts the staff (internal, never held)', async () => {
    silentMock.mockResolvedValue(true);
    await notifyArrival('pat-1', ['a']);
    expect(sendMock).not.toHaveBeenCalled();
    expect(holdMock).toHaveBeenCalledTimes(1);
    expect(staffMock).toHaveBeenCalledWith({ patientId: 'pat-1', appointmentIds: ['a'] });
  });

  it('a staff-alert failure is swallowed and never hides the patient message', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    staffMock.mockRejectedValue(new Error('template misconfigured'));
    await expect(notifyArrival('pat-1', ['a'])).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0]![0])).not.toMatch(/\+?\d{7,}/);
    errSpy.mockRestore();
  });

  it('a patient-message failure never hides the staff alert', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMock.mockRejectedValue(new Error('redis down'));
    await notifyArrival('pat-1', ['a']);
    expect(staffMock).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
