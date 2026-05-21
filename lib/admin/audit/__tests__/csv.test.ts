import { AuditAction } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { auditRowToCsv, AUDIT_CSV_HEADER } from '../csv';

const baseRow = {
  id: 'r1',
  createdAt: new Date('2026-06-01T10:00:00Z'),
  actorId: 'u1',
  actorFullNameEn: 'Test Actor',
  actorFullNameAr: 'منفذ تجريبي',
  impersonatedUserId: null,
  impersonatedFullNameEn: null,
  impersonatedFullNameAr: null,
  entityType: 'Appointment',
  entityId: 'a1',
  action: AuditAction.UPDATE,
  beforeJson: null,
  afterJson: null,
};

describe('auditRowToCsv', () => {
  it('header has exactly 8 comma-separated columns', () => {
    expect(AUDIT_CSV_HEADER.split(',')).toHaveLength(8);
  });

  it('emits a row in header order', () => {
    expect(auditRowToCsv(baseRow)).toBe(
      '2026-06-01T10:00:00.000Z,Test Actor,,Appointment,a1,UPDATE,,',
    );
  });

  it('includes the impersonated user when set', () => {
    const out = auditRowToCsv({
      ...baseRow,
      impersonatedUserId: 'u9',
      impersonatedFullNameEn: 'Layan Therapist',
    });
    expect(out).toBe('2026-06-01T10:00:00.000Z,Test Actor,Layan Therapist,Appointment,a1,UPDATE,,');
  });

  it('quotes fields containing commas', () => {
    const out = auditRowToCsv({ ...baseRow, actorFullNameEn: 'Last, First' });
    expect(out).toContain(',"Last, First",');
  });

  it('doubles inner quotes per RFC 4180', () => {
    const out = auditRowToCsv({ ...baseRow, afterJson: '{"x":"a\\"b"}' });
    // The JSON string contains a literal backslash + quote; the CSV
    // serializer wraps the field in quotes and doubles every inner quote.
    expect(out.endsWith('"{""x"":""a\\""b""}"')).toBe(true);
  });

  it('quotes fields containing newlines', () => {
    const out = auditRowToCsv({ ...baseRow, beforeJson: 'line1\nline2' });
    expect(out).toContain('"line1\nline2"');
  });
});
