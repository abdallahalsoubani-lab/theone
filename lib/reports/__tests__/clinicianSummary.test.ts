import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Clinician summary counting rules (Prompt 40 §1 — owner package). The db
 * mock honours the query's own WHERE (type + range), so exclusions must come
 * from the code under test.
 */

interface MockLink {
  therapistId: string;
  therapist: { fullNameEn: string; fullNameAr: string; role: string };
  appointment: { status: string; startsAt: Date; appointmentType: string };
}

vi.mock('@/lib/db', () => {
  const state = { links: [] as MockLink[] };
  return {
    __state: state,
    db: {
      appointmentTherapist: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              appointment: {
                startsAt: { gte: Date; lt: Date };
                appointmentType: { in: string[] };
              };
            };
          }) =>
            state.links.filter(
              (l) =>
                where.appointment.appointmentType.in.includes(l.appointment.appointmentType) &&
                l.appointment.startsAt.getTime() >= where.appointment.startsAt.gte.getTime() &&
                l.appointment.startsAt.getTime() < where.appointment.startsAt.lt.getTime(),
            ),
        ),
      },
    },
  };
});

import * as dbModule from '@/lib/db';

import { getClinicianSummary } from '../clinicianSummary';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (dbModule as any).__state as { links: MockLink[] };

const START = new Date('2026-07-19T21:00:00Z'); // Sunday 00:00 Amman
const END = new Date('2026-07-26T21:00:00Z');
const IN_RANGE = new Date('2026-07-22T07:00:00Z');

function link(
  therapistId: string,
  status: string,
  over: Partial<MockLink['appointment']> & { nameEn?: string; role?: string } = {},
) {
  state.links.push({
    therapistId,
    therapist: {
      fullNameEn: over.nameEn ?? `Clin ${therapistId}`,
      fullNameAr: `أخصائي ${therapistId}`,
      role: over.role ?? 'THERAPIST',
    },
    appointment: {
      status,
      startsAt: over.startsAt ?? IN_RANGE,
      appointmentType: over.appointmentType ?? 'SESSION',
    },
  });
}

beforeEach(() => {
  state.links = [];
});

describe('getClinicianSummary', () => {
  it('four columns count correctly; Booked = all non-cancelled (§2.2)', async () => {
    link('t1', 'COMPLETED');
    link('t1', 'SCHEDULED');
    link('t1', 'CONFIRMED');
    link('t1', 'IN_PROGRESS');
    link('t1', 'NO_SHOW');
    link('t1', 'CANCELLED');
    const { rows, totals } = await getClinicianSummary({ start: START, end: END });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ completed: 1, booked: 5, cancelled: 1, noShow: 1 });
    expect(totals).toEqual({ completed: 1, booked: 5, cancelled: 1, noShow: 1 });
  });

  it('STRETCHING and EVENT are excluded; GROUP counts (§1.4)', async () => {
    link('t1', 'COMPLETED', { appointmentType: 'STRETCHING' });
    link('t1', 'COMPLETED', { appointmentType: 'EVENT' });
    link('t1', 'COMPLETED', { appointmentType: 'GROUP' });
    const { rows } = await getClinicianSummary({ start: START, end: END });
    expect(rows[0]).toMatchObject({ completed: 1, booked: 1 });
  });

  it('a two-therapist session adds one to EACH clinician (§1.5)', async () => {
    link('t1', 'COMPLETED', { nameEn: 'Ahmad' });
    link('t2', 'COMPLETED', { nameEn: 'Layan' });
    const { rows, totals } = await getClinicianSummary({ start: START, end: END });
    expect(rows.map((r) => [r.fullNameEn, r.completed])).toEqual([
      ['Ahmad', 1],
      ['Layan', 1],
    ]);
    expect(totals.completed).toBe(2); // may exceed distinct sessions — the footnote's point
  });

  it('range boundaries are half-open [start, end) — a 23:30-Amman booking stays in its day', async () => {
    // 2026-07-25 23:30 Amman = 2026-07-25T20:30Z — inside [19th, 26th) Amman.
    link('t1', 'SCHEDULED', { startsAt: new Date('2026-07-25T20:30:00Z') });
    // Exactly the exclusive end (26th 00:00 Amman) — outside.
    link('t1', 'SCHEDULED', { startsAt: new Date('2026-07-26T21:00:00Z') });
    const { rows } = await getClinicianSummary({ start: START, end: END });
    expect(rows[0]!.booked).toBe(1);
  });

  it('doctor rows are included and labeled by role (§2.3)', async () => {
    link('doc1', 'COMPLETED', { nameEn: 'Dr Sara', role: 'DOCTOR' });
    const { rows } = await getClinicianSummary({ start: START, end: END });
    expect(rows[0]).toMatchObject({ role: 'DOCTOR', completed: 1 });
  });

  it('no patient fields anywhere in the result (PII-free surface)', async () => {
    link('t1', 'COMPLETED');
    const summary = await getClinicianSummary({ start: START, end: END });
    expect(JSON.stringify(summary)).not.toMatch(/patient|phone|email/i);
  });
});
