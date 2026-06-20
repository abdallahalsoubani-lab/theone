import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { auditLog: { findMany: vi.fn(), count: vi.fn() } },
}));

const { db } = await import('@/lib/db');
const { listAuditLogs } = await import('../queries');

const findMany = db.auditLog.findMany as unknown as ReturnType<typeof vi.fn>;
const count = db.auditLog.count as unknown as ReturnType<typeof vi.fn>;

function dbRow(after: unknown, action = 'UPDATE') {
  return {
    id: 'a1',
    createdAt: new Date('2026-06-01T10:00:00Z'),
    actorId: 'actor1',
    actor: { fullNameEn: 'Admin', fullNameAr: 'مسؤول' },
    impersonatedUserId: null,
    impersonatedUser: null,
    entityType: 'Appointment',
    entityId: 'appt1',
    action,
    before: null,
    after,
  };
}

beforeEach(() => {
  findMany.mockReset();
  count.mockReset();
  count.mockResolvedValue(1);
});

describe('listAuditLogs — surfaced event (Fix 6A)', () => {
  it('surfaces after.event into row.event while keeping the base action', async () => {
    findMany.mockResolvedValue([dbRow({ event: 'APPOINTMENT_CANCELLED' })]);
    const { rows } = await listAuditLogs({}, { page: 1, pageSize: 50 });
    expect(rows[0]!.event).toBe('APPOINTMENT_CANCELLED');
    expect(rows[0]!.action).toBe('UPDATE'); // base CRUD action preserved
  });

  it('surfaces other meaningful events too (reschedule, status change)', async () => {
    findMany.mockResolvedValue([
      dbRow({ event: 'APPOINTMENT_RESCHEDULED' }),
      dbRow({ event: 'STATUS_CHANGED' }),
    ]);
    const { rows } = await listAuditLogs({}, { page: 1, pageSize: 50 });
    expect(rows.map((r) => r.event)).toEqual(['APPOINTMENT_RESCHEDULED', 'STATUS_CHANGED']);
  });

  it('event is null when the payload has no event tag', async () => {
    findMany.mockResolvedValue([dbRow({ some: 'value' })]);
    const { rows } = await listAuditLogs({}, { page: 1, pageSize: 50 });
    expect(rows[0]!.event).toBeNull();
  });

  it('event is null when there is no after payload', async () => {
    findMany.mockResolvedValue([dbRow(null)]);
    const { rows } = await listAuditLogs({}, { page: 1, pageSize: 50 });
    expect(rows[0]!.event).toBeNull();
  });
});
