import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P15 regression guard, re-run for P61 item 2.
 *
 * Widening phone validation and adding a country selector must NOT leak the
 * phone anywhere it was hidden: DOCTOR and THERAPIST never see patient contact
 * PII, and an ADMIN acting as a Doctor sees what the Doctor sees.
 */
const session = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
}));
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => (session.user ? { user: session.user } : null)),
}));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('@/lib/rbac/guards', () => ({ ForbiddenError: class extends Error {} }));
vi.mock('../assignment', () => ({ isClinicianAssignedTo: vi.fn(async () => true) }));

import { viewerCanSeePatientContact } from '../access';

beforeEach(() => {
  session.user = null;
});

describe('viewerCanSeePatientContact', () => {
  it('SECRETARY and ADMIN see the phone', async () => {
    for (const role of ['SECRETARY', 'ADMIN']) {
      session.user = { id: 'u1', role };
      expect(await viewerCanSeePatientContact()).toBe(true);
    }
  });

  it('DOCTOR and THERAPIST never see the phone — assigned or not', async () => {
    for (const role of ['DOCTOR', 'THERAPIST']) {
      session.user = { id: 'u1', role };
      expect(await viewerCanSeePatientContact()).toBe(false);
      expect(await viewerCanSeePatientContact('p1')).toBe(false);
    }
  });

  it('a PATIENT sees only their own contact details', async () => {
    session.user = { id: 'p1', role: 'PATIENT' };
    expect(await viewerCanSeePatientContact('p1')).toBe(true);
    expect(await viewerCanSeePatientContact('p2')).toBe(false);
  });

  it('no session → nothing (fail-closed for workers and tests)', async () => {
    expect(await viewerCanSeePatientContact('p1')).toBe(false);
  });
});
