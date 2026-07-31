import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn(async () => undefined) }));
vi.mock('@/lib/whatsapp/templates/sendArrival', () => ({ sendArrivalConfirmation: sendMock }));

import { notifyArrival } from '../notify-arrival';

describe('notifyArrival (July 31 item 3 — failure isolation)', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue(undefined);
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
