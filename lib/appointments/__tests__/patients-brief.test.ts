import { describe, expect, it, vi } from 'vitest';

/**
 * P52 follow-up incident regression — listActivePatientsBrief feeds every
 * patient PICKER (booking modal, waitlist, inbox link). The silent take:200
 * hid patients past rank 200 once the 257 imports landed. Pins:
 *   1. NO row cap — the whole roster reaches the client-side picker.
 *   2. NO hidden filters — pendingFirstVisit is a SOFT flag (P41), never a
 *      where-clause; intake status never excludes.
 */

const captured: { findManyArgs: Record<string, unknown> | null } = { findManyArgs: null };

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        captured.findManyArgs = args;
        return [
          { id: 'imp-c-001', fullNameEn: '', fullNameAr: 'طفل مستورد', phone: null },
          { id: 'p-pending', fullNameEn: 'Pending Visit', fullNameAr: '', phone: '+962790000009' },
        ];
      }),
    },
  },
}));

vi.mock('@/lib/patients/access', () => ({
  viewerCanSeePatientPhone: vi.fn(async () => true),
}));

vi.mock('@/lib/patients/first-visit', () => ({
  // p-pending awaits their first doctor visit — the SOFT flag.
  pendingFirstVisitIds: vi.fn(async () => new Set(['p-pending'])),
}));

import { listActivePatientsBrief } from '../queries';

describe('listActivePatientsBrief', () => {
  it('fetches the WHOLE roster — no take cap, no hidden status filters', async () => {
    await listActivePatientsBrief();
    expect(captured.findManyArgs).not.toBeNull();
    expect(captured.findManyArgs).not.toHaveProperty('take');
    // The only filters allowed: role + soft-delete. Anything else (intake
    // status, first-visit state, active flags) is a regression.
    expect(captured.findManyArgs!.where).toEqual({ role: 'PATIENT', deletedAt: null });
  });

  it('"pending first doctor visit" is a soft FLAG on the row, never an exclusion (P41)', async () => {
    const rows = await listActivePatientsBrief();
    const pending = rows.find((r) => r.id === 'p-pending');
    expect(pending).toBeDefined();
    expect(pending!.pendingFirstVisit).toBe(true);
    // The AR-only import is present too.
    expect(rows.some((r) => r.id === 'imp-c-001')).toBe(true);
  });
});
