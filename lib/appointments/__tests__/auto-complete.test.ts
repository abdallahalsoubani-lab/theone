import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * July change request #4 — sessions auto-complete at their scheduled end.
 * The transition is guarded (only IN_PROGRESS), idempotent, and audited with
 * the SYSTEM actor. A session that never started (SCHEDULED/CONFIRMED) or is
 * already terminal is never force-completed — enforced by the status guard in
 * the updateMany WHERE clause.
 */

const updateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
const auditCreate = vi.fn(async (_arg: unknown) => ({}));

vi.mock('@/lib/db', () => ({
  db: {
    appointment: { updateMany: (arg: unknown) => updateMany(arg) },
    auditLog: { create: (arg: unknown) => auditCreate(arg) },
  },
}));
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => null),
}));

import { autoCompleteSession } from '../auto-complete';

describe('autoCompleteSession', () => {
  beforeEach(() => {
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    auditCreate.mockReset().mockResolvedValue({});
  });

  it('completes ONLY an IN_PROGRESS session (guarded update) and audits as SYSTEM', async () => {
    const res = await autoCompleteSession('appt-1');
    expect(res).toEqual({ completed: true });
    // The status guard in the WHERE clause is what excludes never-started /
    // cancelled / no-show / already-completed sessions.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'appt-1', status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED' },
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'system',
          entityType: 'Appointment',
          entityId: 'appt-1',
          after: { event: 'SESSION_AUTO_COMPLETED', applied: true },
        }),
      }),
    );
  });

  it('is an idempotent no-op when nothing matched the guard (count 0)', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await autoCompleteSession('appt-2');
    expect(res).toEqual({ completed: false });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          after: { event: 'SESSION_AUTO_COMPLETED', applied: false },
        }),
      }),
    );
  });
});
