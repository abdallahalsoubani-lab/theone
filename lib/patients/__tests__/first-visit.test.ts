import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 41 — NI-5 doctor-first-visit flow (owner ruling: SOFT enforcement).
 *
 * The flag is DERIVED, never stored: pending until ≥1 COMPLETED appointment
 * whose assigned clinicians include a DOCTOR. Cancelled / no-show doctor
 * visits keep the flag on. The batch helper must stay one query per page
 * (no N+1). The policy helpers own who sees badge / CTA / notice.
 */

vi.mock('@/lib/db', () => {
  interface Appt {
    id: string;
    patientId: string;
    status: string;
    clinicianRoles: string[];
  }
  const state = { appointments: [] as Appt[] };

  // Mirrors the where-shape the module builds: status COMPLETED + an
  // AppointmentTherapist member whose user role is DOCTOR.
  const matches = (a: Appt, where: Record<string, unknown>) => {
    const patientId = where.patientId as string | { in: string[] };
    const idOk =
      typeof patientId === 'string'
        ? a.patientId === patientId
        : patientId.in.includes(a.patientId);
    const statusOk = a.status === where.status;
    const roleWanted = (where.therapists as { some: { therapist: { role: string } } } | undefined)
      ?.some.therapist.role;
    const roleOk = roleWanted ? a.clinicianRoles.includes(roleWanted) : true;
    return idOk && statusOk && roleOk;
  };

  return {
    __state: state,
    db: {
      appointment: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const hit = state.appointments.find((a) => matches(a, where));
          return hit ? { id: hit.id } : null;
        }),
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const seen = new Set<string>();
          const out: Array<{ patientId: string }> = [];
          for (const a of state.appointments.filter((x) => matches(x, where))) {
            if (seen.has(a.patientId)) continue; // distinct: ['patientId']
            seen.add(a.patientId);
            out.push({ patientId: a.patientId });
          }
          return out;
        }),
      },
    },
  };
});

import type { UserRole } from '@prisma/client';

import { hasCompletedDoctorVisit, pendingFirstVisitIds } from '../first-visit';
import { bookDoctorVisitHref, canSeeFirstVisitBadge } from '../first-visit-policy';

const { __state, db } = (await import('@/lib/db')) as unknown as {
  __state: {
    appointments: Array<{
      id: string;
      patientId: string;
      status: string;
      clinicianRoles: string[];
    }>;
  };
  db: { appointment: { findMany: ReturnType<typeof vi.fn> } };
};

let counter = 0;
const addAppt = (patientId: string, status: string, clinicianRoles: string[]) => {
  counter += 1;
  __state.appointments.push({ id: `appt-${counter}`, patientId, status, clinicianRoles });
};

beforeEach(() => {
  __state.appointments.length = 0;
  counter = 0;
  db.appointment.findMany.mockClear();
});

describe('hasCompletedDoctorVisit derivation', () => {
  it('zero appointments → pending (no completed doctor visit)', async () => {
    expect(await hasCompletedDoctorVisit('p1')).toBe(false);
  });

  it('completed therapist-only session → still pending', async () => {
    addAppt('p1', 'COMPLETED', ['THERAPIST']);
    expect(await hasCompletedDoctorVisit('p1')).toBe(false);
  });

  it('completed doctor appointment → not pending', async () => {
    addAppt('p1', 'COMPLETED', ['DOCTOR']);
    expect(await hasCompletedDoctorVisit('p1')).toBe(true);
  });

  it('completed mixed doctor+therapist appointment → not pending', async () => {
    addAppt('p1', 'COMPLETED', ['THERAPIST', 'DOCTOR']);
    expect(await hasCompletedDoctorVisit('p1')).toBe(true);
  });

  it('cancelled / no-show doctor visits keep the flag on', async () => {
    addAppt('p1', 'CANCELLED', ['DOCTOR']);
    addAppt('p1', 'NO_SHOW', ['DOCTOR']);
    addAppt('p1', 'SCHEDULED', ['DOCTOR']);
    expect(await hasCompletedDoctorVisit('p1')).toBe(false);
  });
});

describe('pendingFirstVisitIds (batch, list pages)', () => {
  it('returns exactly the patients without a completed doctor visit', async () => {
    addAppt('done', 'COMPLETED', ['DOCTOR']);
    addAppt('therapy-only', 'COMPLETED', ['THERAPIST']);
    addAppt('cancelled-dr', 'CANCELLED', ['DOCTOR']);
    const pending = await pendingFirstVisitIds(['done', 'therapy-only', 'cancelled-dr', 'new']);
    expect(pending).toEqual(new Set(['therapy-only', 'cancelled-dr', 'new']));
  });

  it('is ONE query regardless of page size (no N+1)', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `p-${i}`);
    await pendingFirstVisitIds(ids);
    expect(db.appointment.findMany).toHaveBeenCalledTimes(1);
  });

  it('empty input short-circuits without querying', async () => {
    expect(await pendingFirstVisitIds([])).toEqual(new Set());
    expect(db.appointment.findMany).not.toHaveBeenCalled();
  });
});

describe('first-visit UI policy', () => {
  it('badge: secretary/admin/doctor see it, therapist/patient never', () => {
    expect(canSeeFirstVisitBadge('SECRETARY')).toBe(true);
    expect(canSeeFirstVisitBadge('ADMIN')).toBe(true);
    expect(canSeeFirstVisitBadge('DOCTOR')).toBe(true);
    expect(canSeeFirstVisitBadge('THERAPIST')).toBe(false);
    expect(canSeeFirstVisitBadge('PATIENT')).toBe(false);
  });

  it('CTA: pending patient → doctor-scoped deep link into the viewer calendar', () => {
    expect(bookDoctorVisitHref('SECRETARY', 'p1', true)).toBe(
      '/secretary/calendar?bookPatient=p1&doctors=1',
    );
    expect(bookDoctorVisitHref('ADMIN', 'p1', true)).toBe(
      '/admin/calendar?bookPatient=p1&doctors=1',
    );
  });

  it('CTA: absent once the first visit is completed, and never for non-booking roles', () => {
    expect(bookDoctorVisitHref('SECRETARY', 'p1', false)).toBeNull();
    expect(bookDoctorVisitHref('ADMIN', 'p1', false)).toBeNull();
    for (const role of ['DOCTOR', 'THERAPIST', 'PATIENT'] as UserRole[]) {
      expect(bookDoctorVisitHref(role, 'p1', true)).toBeNull();
    }
  });

  it('the booking-modal notice is gone (Prompt 55 §3) — the policy module only exposes badge + CTA', async () => {
    const policy = await import('../first-visit-policy');
    expect('showFirstVisitNotice' in policy).toBe(false);
    expect(Object.keys(policy).sort()).toEqual(['bookDoctorVisitHref', 'canSeeFirstVisitBadge']);
  });
});
