import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Doctor-dashboard "my appointments today" (Prompt 33 — NI-1). Doctors are
 * bookable clinicians (resource lanes include DOCTOR), so their dashboard
 * lists rows where they appear in the AppointmentTherapist M2M — the same
 * definition the calendar uses, so counts agree.
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
              therapists: { some: { therapistId: string } };
              startsAt: { gte: Date; lt: Date };
              status?: { not?: string };
            };
          }) => {
            const id = where.therapists.some.therapistId;
            return state.appts
              .filter(
                (a) =>
                  a.therapistIds.includes(id) &&
                  // Honour the query's own status clause — the exclusion must
                  // come from the WHERE the code under test builds.
                  (where.status?.not === undefined || a.status !== where.status.not) &&
                  a.startsAt.getTime() >= where.startsAt.gte.getTime() &&
                  a.startsAt.getTime() < where.startsAt.lt.getTime(),
              )
              .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
          },
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

function addAppt(over: Partial<MockAppt> & Pick<MockAppt, 'id' | 'startsAt' | 'therapistIds'>) {
  state.appts.push({
    status: 'SCHEDULED',
    checkedInAt: null,
    patientId: 'p1',
    title: null,
    patient: { fullNameEn: 'John', fullNameAr: 'جون' },
    ...over,
  });
}

beforeEach(() => {
  state.appts = [];
});

describe('listTodayAppointmentsForClinician', () => {
  it("returns the doctor's own bookings for the day, ordered by start", async () => {
    addAppt({ id: 'late', startsAt: new Date('2026-07-23T12:00:00Z'), therapistIds: ['doc-1'] });
    addAppt({ id: 'early', startsAt: new Date('2026-07-23T07:00:00Z'), therapistIds: ['doc-1'] });
    const rows = await listTodayAppointmentsForClinician({
      clinicianId: 'doc-1',
      dayStart: DAY_START,
      dayEnd: DAY_END,
    });
    expect(rows.map((r) => r.id)).toEqual(['early', 'late']);
  });

  it("does NOT return an unrelated clinician's bookings (denial)", async () => {
    addAppt({ id: 'a', startsAt: new Date('2026-07-23T07:00:00Z'), therapistIds: ['doc-2'] });
    const rows = await listTodayAppointmentsForClinician({
      clinicianId: 'doc-1',
      dayStart: DAY_START,
      dayEnd: DAY_END,
    });
    expect(rows).toEqual([]);
  });

  it('excludes cancelled rows and out-of-day rows', async () => {
    addAppt({
      id: 'cancelled',
      startsAt: new Date('2026-07-23T07:00:00Z'),
      therapistIds: ['doc-1'],
      status: 'CANCELLED',
    });
    addAppt({
      id: 'tomorrow',
      startsAt: new Date('2026-07-23T22:00:00Z'),
      therapistIds: ['doc-1'],
    });
    const rows = await listTodayAppointmentsForClinician({
      clinicianId: 'doc-1',
      dayStart: DAY_START,
      dayEnd: DAY_END,
    });
    expect(rows).toEqual([]);
  });
});
