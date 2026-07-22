import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Doctor-dashboard "clinic appointments today" (Prompt 33 NI-1 → Prompt 39
 * owner ruling, option c): ALL clinic appointments for the clinic-local day,
 * cancelled excluded (matching the calendar), chronological, therapist names
 * included for the compact list — no phone in the shape.
 */

interface MockAppt {
  id: string;
  startsAt: Date;
  status: string;
  checkedInAt: Date | null;
  patientId: string | null;
  title: string | null;
  patient: { fullNameEn: string; fullNameAr: string } | null;
  therapists: Array<{ therapist: { fullNameEn: string; fullNameAr: string } }>;
}

vi.mock('@/lib/db', () => {
  const state = { appts: [] as MockAppt[] };
  return {
    __state: state,
    db: {
      appointment: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              startsAt: { gte: Date; lt: Date };
              status?: { not?: string };
            };
          }) =>
            state.appts
              .filter(
                (a) =>
                  // Honour the query's own clauses — exclusions must come from
                  // the WHERE the code under test builds.
                  (where.status?.not === undefined || a.status !== where.status.not) &&
                  a.startsAt.getTime() >= where.startsAt.gte.getTime() &&
                  a.startsAt.getTime() < where.startsAt.lt.getTime(),
              )
              .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime()),
        ),
      },
    },
  };
});

import * as dbModule from '@/lib/db';

import { listTodayAppointmentsForClinic } from '../queries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (dbModule as any).__state as { appts: MockAppt[] };

const DAY_START = new Date('2026-07-22T21:00:00Z'); // clinic midnight (Amman)
const DAY_END = new Date('2026-07-23T21:00:00Z');

function addAppt(over: Partial<MockAppt> & Pick<MockAppt, 'id' | 'startsAt'>) {
  state.appts.push({
    status: 'SCHEDULED',
    checkedInAt: null,
    patientId: 'p1',
    title: null,
    patient: { fullNameEn: 'John', fullNameAr: 'جون' },
    therapists: [{ therapist: { fullNameEn: 'Ahmad', fullNameAr: 'أحمد' } }],
    ...over,
  });
}

beforeEach(() => {
  state.appts = [];
});

describe('listTodayAppointmentsForClinic', () => {
  it('returns EVERY clinician’s bookings for the day, ordered by start (owner ruling c)', async () => {
    addAppt({ id: 'late', startsAt: new Date('2026-07-23T12:00:00Z') });
    addAppt({
      id: 'early',
      startsAt: new Date('2026-07-23T07:00:00Z'),
      therapists: [{ therapist: { fullNameEn: 'Layan', fullNameAr: 'ليان' } }],
    });
    const rows = await listTodayAppointmentsForClinic({ dayStart: DAY_START, dayEnd: DAY_END });
    expect(rows.map((r) => r.id)).toEqual(['early', 'late']);
    expect(rows[0]!.therapists).toEqual([{ fullNameEn: 'Layan', fullNameAr: 'ليان' }]);
  });

  it('excludes cancelled and out-of-day rows via its own WHERE clause', async () => {
    addAppt({
      id: 'cancelled',
      startsAt: new Date('2026-07-23T07:00:00Z'),
      status: 'CANCELLED',
    });
    addAppt({ id: 'tomorrow', startsAt: new Date('2026-07-23T22:00:00Z') });
    const rows = await listTodayAppointmentsForClinic({ dayStart: DAY_START, dayEnd: DAY_END });
    expect(rows).toEqual([]);
  });

  it('carries no phone or contact fields (privacy shape)', async () => {
    addAppt({ id: 'a', startsAt: new Date('2026-07-23T07:00:00Z') });
    const rows = await listTodayAppointmentsForClinic({ dayStart: DAY_START, dayEnd: DAY_END });
    expect(JSON.stringify(rows)).not.toMatch(/phone|email/i);
  });
});
