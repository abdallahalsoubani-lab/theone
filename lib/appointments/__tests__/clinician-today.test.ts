import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Doctor-dashboard "my appointments today" (PT-B1 item 2 — reversing the
 * Prompt 39 clinic-wide ruling): only the rows where the logged-in clinician
 * is an assigned clinician, cancelled excluded (matching the calendar),
 * chronological, co-treating therapist names included, no phone.
 *
 * The mock honours the WHERE the code under test builds, so a dropped
 * `therapists.some` clause fails here rather than leaking in production.
 */

interface MockAppt {
  id: string;
  startsAt: Date;
  status: string;
  checkedInAt: Date | null;
  patientId: string | null;
  title: string | null;
  patient: { fullNameEn: string; fullNameAr: string } | null;
  therapistIds: string[];
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
              therapists?: { some?: { therapistId?: string } };
            };
          }) =>
            state.appts
              .filter((a) => {
                const wanted = where.therapists?.some?.therapistId;
                return (
                  // An absent clause means "no filter" — exactly the leak this
                  // suite guards, so it must come from the query itself.
                  (wanted === undefined || a.therapistIds.includes(wanted)) &&
                  (where.status?.not === undefined || a.status !== where.status.not) &&
                  a.startsAt.getTime() >= where.startsAt.gte.getTime() &&
                  a.startsAt.getTime() < where.startsAt.lt.getTime()
                );
              })
              .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime()),
        ),
      },
    },
  };
});

import * as dbModule from '@/lib/db';

import { listTodayAppointmentsForClinician } from '../queries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (dbModule as any).__state as { appts: MockAppt[] };

const DAY_START = new Date('2026-07-22T21:00:00Z'); // clinic midnight (Amman)
const DAY_END = new Date('2026-07-23T21:00:00Z');
const ME = 'doctor-rawan';
const OTHER = 'doctor-sara';

function addAppt(over: Partial<MockAppt> & Pick<MockAppt, 'id' | 'startsAt'>) {
  state.appts.push({
    status: 'SCHEDULED',
    checkedInAt: null,
    patientId: 'p1',
    title: null,
    patient: { fullNameEn: 'John', fullNameAr: 'جون' },
    therapistIds: [ME],
    therapists: [{ therapist: { fullNameEn: 'Ahmad', fullNameAr: 'أحمد' } }],
    ...over,
  });
}

beforeEach(() => {
  state.appts = [];
});

describe('listTodayAppointmentsForClinician', () => {
  it('returns only the caller’s own bookings, ordered by start', async () => {
    addAppt({ id: 'mine-late', startsAt: new Date('2026-07-23T12:00:00Z') });
    addAppt({ id: 'mine-early', startsAt: new Date('2026-07-23T07:00:00Z') });
    addAppt({
      id: 'someone-else',
      startsAt: new Date('2026-07-23T08:00:00Z'),
      therapistIds: [OTHER],
      therapists: [{ therapist: { fullNameEn: 'Layan', fullNameAr: 'ليان' } }],
    });

    const rows = await listTodayAppointmentsForClinician({
      clinicianId: ME,
      dayStart: DAY_START,
      dayEnd: DAY_END,
    });
    expect(rows.map((r) => r.id)).toEqual(['mine-early', 'mine-late']);
  });

  it('gives each clinician a different day — no shared clinic view', async () => {
    addAppt({ id: 'mine', startsAt: new Date('2026-07-23T07:00:00Z') });
    addAppt({
      id: 'theirs',
      startsAt: new Date('2026-07-23T08:00:00Z'),
      therapistIds: [OTHER],
    });

    const mine = await listTodayAppointmentsForClinician({
      clinicianId: ME,
      dayStart: DAY_START,
      dayEnd: DAY_END,
    });
    const theirs = await listTodayAppointmentsForClinician({
      clinicianId: OTHER,
      dayStart: DAY_START,
      dayEnd: DAY_END,
    });
    expect(mine.map((r) => r.id)).toEqual(['mine']);
    expect(theirs.map((r) => r.id)).toEqual(['theirs']);
  });

  it('keeps a co-treated session for every clinician on it', async () => {
    addAppt({
      id: 'co-treated',
      startsAt: new Date('2026-07-23T07:00:00Z'),
      therapistIds: [ME, OTHER],
      therapists: [
        { therapist: { fullNameEn: 'Rawan', fullNameAr: 'روان' } },
        { therapist: { fullNameEn: 'Sara', fullNameAr: 'سارة' } },
      ],
    });

    for (const id of [ME, OTHER]) {
      const rows = await listTodayAppointmentsForClinician({
        clinicianId: id,
        dayStart: DAY_START,
        dayEnd: DAY_END,
      });
      expect(rows.map((r) => r.id)).toEqual(['co-treated']);
      expect(rows[0]!.therapists).toHaveLength(2);
    }
  });

  it('excludes cancelled and out-of-day rows via its own WHERE clause', async () => {
    addAppt({
      id: 'cancelled',
      startsAt: new Date('2026-07-23T07:00:00Z'),
      status: 'CANCELLED',
    });
    addAppt({ id: 'tomorrow', startsAt: new Date('2026-07-23T22:00:00Z') });
    const rows = await listTodayAppointmentsForClinician({
      clinicianId: ME,
      dayStart: DAY_START,
      dayEnd: DAY_END,
    });
    expect(rows).toEqual([]);
  });

  it('carries no phone or contact fields (privacy shape)', async () => {
    addAppt({ id: 'a', startsAt: new Date('2026-07-23T07:00:00Z') });
    const rows = await listTodayAppointmentsForClinician({
      clinicianId: ME,
      dayStart: DAY_START,
      dayEnd: DAY_END,
    });
    expect(JSON.stringify(rows)).not.toMatch(/phone|email/i);
  });
});
