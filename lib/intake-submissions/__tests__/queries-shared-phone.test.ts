import { describe, expect, it, vi } from 'vitest';

/**
 * P57 — the public intake queue's duplicate-by-phone lookup returns EVERY
 * active patient on a shared family number (never a silent first match),
 * so the reviewer must pick which record to link.
 */
const rows = [
  { id: 'child-a', fullNameEn: 'Ahmad', fullNameAr: 'أحمد', phone: '+962790000000' },
  { id: 'child-b', fullNameEn: 'Sara', fullNameAr: 'سارة', phone: '+962790000000' },
];
const findMany = vi.fn(async () => rows);
vi.mock('@/lib/db', () => ({
  db: { user: { findMany: (...a: unknown[]) => findMany(...(a as [])) } },
}));

import { findPatientsByPhone } from '../queries';

describe('findPatientsByPhone (P57)', () => {
  it('returns all active PATIENT holders of the number, oldest first', async () => {
    const result = await findPatientsByPhone('+962790000000');
    expect(result.map((r) => r.id)).toEqual(['child-a', 'child-b']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phone: '+962790000000', role: 'PATIENT', deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });
});
