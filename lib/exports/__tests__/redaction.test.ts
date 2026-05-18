import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import type { PermissionUser } from '@/lib/rbac/can';

import { resolveRedaction } from '../redaction';

const u = (role: UserRole, id = 'self'): PermissionUser => ({ id, role });

describe('resolveRedaction', () => {
  it('returns SELF when the patient exports their own file', () => {
    expect(resolveRedaction(u(UserRole.PATIENT, 'p1'), 'p1')).toBe('SELF');
  });

  it('refuses when a patient tries to export someone else', () => {
    expect(resolveRedaction(u(UserRole.PATIENT, 'p1'), 'p2')).toBeNull();
  });

  it('returns ADMIN for an Admin requester', () => {
    expect(resolveRedaction(u(UserRole.ADMIN), 'p1')).toBe('ADMIN');
  });

  it('returns CLINICAL for Doctor / Therapist / Secretary', () => {
    expect(resolveRedaction(u(UserRole.DOCTOR), 'p1')).toBe('CLINICAL');
    expect(resolveRedaction(u(UserRole.THERAPIST), 'p1')).toBe('CLINICAL');
    expect(resolveRedaction(u(UserRole.SECRETARY), 'p1')).toBe('CLINICAL');
  });
});
