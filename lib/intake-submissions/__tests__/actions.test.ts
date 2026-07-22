import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 41 — NI-5 §3.1: approving an intake submission lands the reviewer
 * directly on the new patient's file. The action returns the redirect target
 * built from the EFFECTIVE viewer role (A-19 — an Admin reviewer must stay in
 * the Admin shell, not get teleported into the Secretary interface).
 */

const viewerRef: { current: { id: string; role: string } } = {
  current: { id: 'sec-1', role: 'SECRETARY' },
};
vi.mock('@/lib/rbac/guards', () => ({
  requirePermission: vi.fn(async () => viewerRef.current),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../services', () => ({
  approveSubmissionNew: vi.fn(async () => ({ patientId: 'patient-9' })),
  approveSubmissionLink: vi.fn(async () => ({ patientId: 'patient-9' })),
  rejectSubmission: vi.fn(async () => ({ submissionId: 'sub-1' })),
}));

import { approveSubmissionLinkAction, approveSubmissionNewAction } from '../actions';

beforeEach(() => {
  viewerRef.current = { id: 'sec-1', role: 'SECRETARY' };
});

describe('post-approval redirect target (role-correct)', () => {
  it('approve-new returns the SECRETARY patient-file href for a secretary', async () => {
    const res = await approveSubmissionNewAction({ submissionId: 'sub-1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({
      patientId: 'patient-9',
      redirectTo: '/secretary/patients/patient-9',
    });
  });

  it('approve-new returns the ADMIN patient-file href for an admin reviewer', async () => {
    viewerRef.current = { id: 'admin-1', role: 'ADMIN' };
    const res = await approveSubmissionNewAction({ submissionId: 'sub-1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.redirectTo).toBe('/admin/patients/patient-9');
  });

  it('approve-link (duplicate phone) redirects to the linked patient file too', async () => {
    const res = await approveSubmissionLinkAction({
      submissionId: 'sub-1',
      patientId: 'patient-9',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.redirectTo).toBe('/secretary/patients/patient-9');
  });
});
