import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 56 — the calendar feed's phone field respects the P15 contact
 * boundary at the DATA layer: `patientPhone` ships only when
 * viewerCanSeePatientContact() passes (Secretary/Admin); Doctor/Therapist
 * viewers — and sessionless callers — get null. The tooltip renders-if-
 * present and never fetches separately.
 */

vi.mock('@/lib/db', () => {
  const state = { rows: [] as Array<Record<string, unknown>> };
  return {
    __state: state,
    db: {
      appointment: {
        findMany: vi.fn(async () => state.rows),
      },
    },
  };
});

vi.mock('@/lib/patients/access', () => ({
  viewerCanSeePatientContact: vi.fn(async () => false),
}));

import { viewerCanSeePatientContact } from '@/lib/patients/access';

import { listAppointmentsForCalendar } from '../queries';

const accessMock = vi.mocked(viewerCanSeePatientContact);

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: { rows: Array<Record<string, unknown>> };
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  patient: { id: 'p1', fullNameEn: 'John', fullNameAr: 'جون', phone: '+962790000001' },
  groupPatients: [],
  therapists: [{ therapist: { id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' } }],
  room: null,
  title: null,
  startsAt: new Date('2026-06-01T09:00:00Z'),
  durationMinutes: 45,
  status: 'SCHEDULED',
  appointmentType: 'SESSION',
  notes: null,
  seriesId: null,
  ...over,
});

const filters = { from: new Date('2026-06-01'), to: new Date('2026-06-02') };

beforeEach(() => {
  __state.rows.length = 0;
  accessMock.mockReset();
  accessMock.mockResolvedValue(false);
});

describe('listAppointmentsForCalendar — patientPhone (P15 boundary)', () => {
  it('viewer with contact access (Secretary/Admin) → phone on the payload', async () => {
    accessMock.mockResolvedValue(true);
    __state.rows.push(row());
    const [a] = await listAppointmentsForCalendar(filters);
    expect(a!.patientPhone).toBe('+962790000001');
  });

  it('viewer WITHOUT contact access (Doctor/Therapist) → null, name intact', async () => {
    accessMock.mockResolvedValue(false);
    __state.rows.push(row());
    const [a] = await listAppointmentsForCalendar(filters);
    expect(a!.patientPhone).toBeNull();
    expect(a!.patientFullNameAr).toBe('جون');
  });

  it('sessionless caller fails closed (access helper returns false) → null', async () => {
    __state.rows.push(row());
    const [a] = await listAppointmentsForCalendar(filters);
    expect(a!.patientPhone).toBeNull();
  });

  it('patient-less EVENT → null phone regardless of access', async () => {
    accessMock.mockResolvedValue(true);
    __state.rows.push(row({ patient: null, appointmentType: 'EVENT', title: 'Maintenance' }));
    const [a] = await listAppointmentsForCalendar(filters);
    expect(a!.patientPhone).toBeNull();
    expect(a!.patientId).toBeNull();
  });
});
