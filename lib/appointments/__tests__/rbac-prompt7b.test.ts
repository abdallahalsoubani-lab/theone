import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { can, type PermissionUser } from '@/lib/rbac/can';

/**
 * RBAC matrix for the Prompt 7b mutating surfaces. Each test pins down
 * one (role, action) cell; the table makes sure that as new roles are
 * added or permissions reshuffled in a later prompt, the regressions
 * surface immediately. ≥ 10 tests cover the cancel-with-category,
 * recurring-series, change-therapist + bulk-series-edit codes across
 * every role in the catalog.
 *
 * Permission codes touched by Prompt 7b:
 *   - appointments.create              (create + create-series)
 *   - appointments.update              (reschedule, change-therapist, bulk modes)
 *   - appointments.cancel              (cancel-with-category + bulk cancel)
 *   - appointments.override_conflict   (per-occurrence OVERRIDE)
 *   - appointments.read                (preview series + therapist availability)
 *
 * The catalog grants are unchanged by Prompt 7b — the schema and flows
 * are new but ride on the existing codes. These tests therefore double
 * as a guard that no Prompt 7b code accidentally introduced a new
 * permission requirement that wasn't wired into ROLE_PERMISSIONS.
 */

const u = (role: UserRole, id = 'u-self'): PermissionUser => ({ id, role });

describe('Prompt 7b RBAC — appointments.create (series builder)', () => {
  it('SECRETARY can create (and therefore create-series)', () => {
    expect(can(u(UserRole.SECRETARY), 'appointments.create')).toBe(true);
  });
  it('ADMIN can create', () => {
    expect(can(u(UserRole.ADMIN), 'appointments.create')).toBe(true);
  });
  it('PATIENT cannot create', () => {
    expect(can(u(UserRole.PATIENT), 'appointments.create')).toBe(false);
  });
  it('DOCTOR can create (Prompt 15 §2B — full scheduling parity with Secretary)', () => {
    expect(can(u(UserRole.DOCTOR), 'appointments.create')).toBe(true);
  });
  it('THERAPIST cannot create', () => {
    expect(can(u(UserRole.THERAPIST), 'appointments.create')).toBe(false);
  });
});

describe('Prompt 7b RBAC — appointments.update (change-therapist + bulk reschedule)', () => {
  it('SECRETARY can update', () => {
    expect(can(u(UserRole.SECRETARY), 'appointments.update')).toBe(true);
  });
  it('ADMIN can update', () => {
    expect(can(u(UserRole.ADMIN), 'appointments.update')).toBe(true);
  });
  it('PATIENT cannot update', () => {
    expect(can(u(UserRole.PATIENT), 'appointments.update')).toBe(false);
  });
  it('THERAPIST cannot reassign their own appointment (admin-only)', () => {
    expect(can(u(UserRole.THERAPIST), 'appointments.update')).toBe(false);
  });
  it('DOCTOR can update appointments directly (Prompt 15 §2B parity)', () => {
    expect(can(u(UserRole.DOCTOR), 'appointments.update')).toBe(true);
  });
});

describe('Prompt 7b RBAC — appointments.cancel (categorized cancel + bulk cancel)', () => {
  it('SECRETARY can cancel', () => {
    expect(can(u(UserRole.SECRETARY), 'appointments.cancel')).toBe(true);
  });
  it('ADMIN can cancel', () => {
    expect(can(u(UserRole.ADMIN), 'appointments.cancel')).toBe(true);
  });
  it('PATIENT cannot cancel directly (must go through reschedule request)', () => {
    expect(can(u(UserRole.PATIENT), 'appointments.cancel')).toBe(false);
  });
  it('THERAPIST cannot cancel', () => {
    expect(can(u(UserRole.THERAPIST), 'appointments.cancel')).toBe(false);
  });
  it('DOCTOR can cancel (Prompt 15 §2B parity)', () => {
    expect(can(u(UserRole.DOCTOR), 'appointments.cancel')).toBe(true);
  });
});

describe('Prompt 7b RBAC — appointments.override_conflict (series OVERRIDE)', () => {
  it('SECRETARY can override conflicts (per-occurrence OVERRIDE in series builder)', () => {
    expect(can(u(UserRole.SECRETARY), 'appointments.override_conflict')).toBe(true);
  });
  it('ADMIN can override conflicts', () => {
    expect(can(u(UserRole.ADMIN), 'appointments.override_conflict')).toBe(true);
  });
  it('PATIENT cannot override conflicts', () => {
    expect(can(u(UserRole.PATIENT), 'appointments.override_conflict')).toBe(false);
  });
  it('THERAPIST cannot override conflicts (would let them double-book themselves)', () => {
    expect(can(u(UserRole.THERAPIST), 'appointments.override_conflict')).toBe(false);
  });
  it('DOCTOR can override conflicts (Prompt 15 §2B parity)', () => {
    expect(can(u(UserRole.DOCTOR), 'appointments.override_conflict')).toBe(true);
  });
});

describe('Prompt 7b RBAC — appointments.read (series preview + therapist availability)', () => {
  it('SECRETARY can read (drives series preview + availability query)', () => {
    expect(can(u(UserRole.SECRETARY), 'appointments.read')).toBe(true);
  });
  it('ADMIN can read', () => {
    expect(can(u(UserRole.ADMIN), 'appointments.read')).toBe(true);
  });
  it('PATIENT cannot read the unscoped calendar (own-only scope applies)', () => {
    expect(can(u(UserRole.PATIENT), 'appointments.read')).toBe(false);
  });
});
