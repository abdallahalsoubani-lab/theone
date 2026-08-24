import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock, silentMock, holdMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async () => undefined),
  silentMock: vi.fn(async () => false),
  holdMock: vi.fn(async () => 'held-1'),
}));
vi.mock('@/lib/whatsapp/templates/sendArrival', () => ({ sendArrivalConfirmation: sendMock }));
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
