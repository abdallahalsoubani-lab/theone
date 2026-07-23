import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));

interface MockUser {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  deletedAt: Date | null;
}
interface MockAppt {
  id: string;
  patientId: string;
  startsAt: Date;
  durationMinutes: number;
  status: string;
  checkedInAt: Date | null;
  checkedInVia: string | null;
}

vi.mock('@/lib/db', () => {
  const state = {
    settings: { timezone: 'Asia/Amman', currentDelayMinutes: 10 },
    users: [] as MockUser[],
    appts: [] as MockAppt[],
    audits: [] as Array<{ actorId: string; entityId: string }>,
  };
  const inWindow = (a: MockAppt, w: { gte: Date; lt: Date }) =>
    a.startsAt.getTime() >= w.gte.getTime() && a.startsAt.getTime() < w.lt.getTime();
  return {
    __state: state,
    db: {
      clinicSettings: { findUnique: vi.fn(async () => state.settings) },
      user: {
        // checkInByName looks up by id; a helper still supports phone-less lookup.
        findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => {
          const u = state.users.find((x) => x.id === where.id && !x.deletedAt);
          return u ?? null;
        }),
        // listTodaysArrivablePatients (Prompt 46): everyone with a bookable
        // appointment in today's clinic-day window.
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              appointmentsAsPatient: {
                some: { startsAt: { gte: Date; lt: Date }; status?: { in: string[] } };
              };
            };
          }) => {
            const some = where.appointmentsAsPatient.some;
            const win = some.startsAt;
            const statuses = some.status?.in;
            const hit = (a: MockAppt) =>
              inWindow(a, win) && (!statuses || statuses.includes(a.status));
            return state.users
              .filter(
                (u) => !u.deletedAt && state.appts.some((a) => a.patientId === u.id && hit(a)),
              )
              .map((u) => ({
                id: u.id,
                fullNameEn: u.fullNameEn,
                fullNameAr: u.fullNameAr,
                appointmentsAsPatient: state.appts
                  .filter((a) => a.patientId === u.id && hit(a))
                  .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())
                  .map((a) => ({
                    id: a.id,
                    startsAt: a.startsAt,
                    durationMinutes: a.durationMinutes,
                    checkedInAt: a.checkedInAt,
                  })),
              }));
          },
        ),
      },
      appointment: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              patientId: string;
              startsAt: { gte: Date; lt: Date };
              status: { in: string[] };
            };
          }) =>
            state.appts
              .filter(
                (a) =>
                  a.patientId === where.patientId &&
                  inWindow(a, where.startsAt) &&
                  where.status.in.includes(a.status),
              )
              .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime()),
        ),
        update: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: { checkedInAt: Date | null; checkedInVia: string | null };
          }) => {
            const a = state.appts.find((x) => x.id === where.id)!;
            a.checkedInAt = data.checkedInAt;
            a.checkedInVia = data.checkedInVia;
            return a;
          },
        ),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: { actorId: string; entityId: string } }) => {
          state.audits.push({ actorId: data.actorId, entityId: data.entityId });
          return data;
        }),
      },
    },
  };
});

import * as dbModule from '@/lib/db';

import { CheckInVia } from '@prisma/client';

import { checkInByName, listTodaysArrivablePatients, recordCheckIn } from '../kiosk';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (dbModule as any).__state as {
  settings: { timezone: string; currentDelayMinutes: number };
  users: MockUser[];
  appts: MockAppt[];
  audits: Array<{ actorId: string; entityId: string }>;
};

// 2026-06-10 12:00 Amman (09:00Z). Clinic day: 2026-06-09T21:00Z .. 2026-06-10T21:00Z.
const NOW = new Date('2026-06-10T09:00:00Z');

function addPatient(id: string, en: string, ar: string) {
  state.users.push({ id, fullNameEn: en, fullNameAr: ar, deletedAt: null });
}
function addAppt(over: Partial<MockAppt> & Pick<MockAppt, 'id' | 'patientId' | 'startsAt'>) {
  state.appts.push({
    durationMinutes: 30,
    status: 'CONFIRMED',
    checkedInAt: null,
    checkedInVia: null,
    ...over,
  });
}

beforeEach(() => {
  state.settings = { timezone: 'Asia/Amman', currentDelayMinutes: 10 };
  state.users = [];
  state.appts = [];
  state.audits = [];
});

describe('checkInByName', () => {
  it('checks in a selected patient with a today appointment (audited, via KIOSK)', async () => {
    addPatient('pat-1', 'Abdullah Khalil', 'عبدالله خليل');
    addAppt({ id: 'appt-1', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:00:00Z') });
    const res = await checkInByName({ patientId: 'pat-1', now: NOW });
    expect(res).toEqual({
      kind: 'CHECKED_IN',
      firstName: 'Abdullah',
      delayMinutes: 10,
      appointmentCount: 1,
    });
    expect(state.appts[0]!.checkedInAt).toEqual(NOW);
    expect(state.appts[0]!.checkedInVia).toBe('KIOSK');
    expect(state.audits).toEqual([{ actorId: 'pat-1', entityId: 'appt-1' }]);
  });

  it('returns generic NO_APPOINTMENT for an unknown patient id (nothing written)', async () => {
    const res = await checkInByName({ patientId: 'nope', now: NOW });
    expect(res).toEqual({ kind: 'NO_APPOINTMENT' });
    expect(state.audits).toHaveLength(0);
  });

  it('reports ALREADY_CHECKED_IN on a second check-in (no second write)', async () => {
    addPatient('pat-1', 'Abdullah', 'عبدالله');
    addAppt({
      id: 'appt-1',
      patientId: 'pat-1',
      startsAt: new Date('2026-06-10T10:00:00Z'),
      checkedInAt: new Date('2026-06-10T08:30:00Z'),
      checkedInVia: 'KIOSK',
    });
    const res = await checkInByName({ patientId: 'pat-1', now: NOW });
    expect(res.kind).toBe('ALREADY_CHECKED_IN');
    expect(state.audits).toHaveLength(0);
  });

  it('reflects the live currentDelayMinutes setting', async () => {
    addPatient('pat-1', 'Abdullah', 'عبدالله');
    addAppt({ id: 'appt-1', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:00:00Z') });
    state.settings.currentDelayMinutes = 25;
    const res = await checkInByName({ patientId: 'pat-1', now: NOW });
    expect(res).toMatchObject({ kind: 'CHECKED_IN', delayMinutes: 25 });
  });
});

describe('checkInByName — arrival grouping (July #3)', () => {
  it('back-to-back run → ONE check-in marks the whole run arrived', async () => {
    addPatient('pat-1', 'Sara', 'سارة');
    addAppt({ id: 'a', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:00:00Z') }); // 10:00-10:30
    addAppt({ id: 'b', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:30:00Z') }); // 10:30-11:00
    const res = await checkInByName({ patientId: 'pat-1', now: NOW });
    expect(res).toMatchObject({ kind: 'CHECKED_IN', appointmentCount: 2 });
    expect(state.appts.find((a) => a.id === 'a')!.checkedInAt).toEqual(NOW);
    expect(state.appts.find((a) => a.id === 'b')!.checkedInAt).toEqual(NOW);
    expect(state.audits.map((x) => x.entityId).sort()).toEqual(['a', 'b']);
  });

  it('spaced-apart → only the current one is arrived; the later stays open', async () => {
    addPatient('pat-1', 'Sara', 'سارة');
    addAppt({ id: 'a', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:00:00Z') });
    addAppt({ id: 'c', patientId: 'pat-1', startsAt: new Date('2026-06-10T13:00:00Z') }); // gap
    const res = await checkInByName({ patientId: 'pat-1', now: NOW });
    expect(res).toMatchObject({ kind: 'CHECKED_IN', appointmentCount: 1 });
    expect(state.appts.find((a) => a.id === 'a')!.checkedInAt).toEqual(NOW);
    expect(state.appts.find((a) => a.id === 'c')!.checkedInAt).toBeNull();
  });

  it('already-arrived appointments are excluded from the run', async () => {
    addPatient('pat-1', 'Sara', 'سارة');
    addAppt({
      id: 'a',
      patientId: 'pat-1',
      startsAt: new Date('2026-06-10T10:00:00Z'),
      checkedInAt: NOW,
      checkedInVia: 'KIOSK',
    });
    addAppt({ id: 'b', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:30:00Z') });
    const res = await checkInByName({ patientId: 'pat-1', now: NOW });
    // Only 'b' is open → it alone is the arrival.
    expect(res).toMatchObject({ kind: 'CHECKED_IN', appointmentCount: 1 });
    expect(state.audits.map((x) => x.entityId)).toEqual(['b']);
  });
});

describe('checkInByName — passed appointment (Prompt 31 §4.4, supersedes Prompt 22 §4.3)', () => {
  const LATE_NOW = new Date('2026-06-10T14:00:00Z');

  it('an appointment whose scheduled end has passed is NOT arrivable → generic NO_APPOINTMENT, nothing written', async () => {
    addPatient('pat-1', 'Abdullah', 'عبدالله');
    // 10:00Z + 30min → ended 10:30Z, long before LATE_NOW (14:00Z).
    addAppt({ id: 'appt-1', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:00:00Z') });
    const res = await checkInByName({ patientId: 'pat-1', now: LATE_NOW });
    expect(res).toEqual({ kind: 'NO_APPOINTMENT' });
    expect(state.appts[0]!.checkedInAt).toBeNull();
    expect(state.audits).toHaveLength(0);
  });

  it('a still-RUNNING appointment (started, not ended) remains arrivable', async () => {
    addPatient('pat-1', 'Abdullah', 'عبدالله');
    // Started 08:45Z, 30min → ends 09:15Z; NOW 09:00Z is inside.
    addAppt({ id: 'appt-1', patientId: 'pat-1', startsAt: new Date('2026-06-10T08:45:00Z') });
    const res = await checkInByName({ patientId: 'pat-1', now: NOW });
    expect(res).toMatchObject({ kind: 'CHECKED_IN', appointmentCount: 1 });
  });

  it('a passed appointment is skipped in favour of a later arrivable one', async () => {
    addPatient('pat-1', 'Abdullah', 'عبدالله');
    addAppt({ id: 'gone', patientId: 'pat-1', startsAt: new Date('2026-06-10T05:00:00Z') });
    addAppt({ id: 'next', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:00:00Z') });
    const res = await checkInByName({ patientId: 'pat-1', now: NOW });
    expect(res).toMatchObject({ kind: 'CHECKED_IN', appointmentCount: 1 });
    expect(state.audits.map((x) => x.entityId)).toEqual(['next']);
  });
});

describe('listTodaysArrivablePatients (Prompt 46 — cards grid, owner privacy reversal)', () => {
  beforeEach(() => {
    addPatient('pat-1', 'Abdullah Khalil', 'عبدالله خليل');
    addPatient('pat-2', 'Abeer Nasser', 'عبير ناصر');
    addPatient('pat-3', 'Omar Ziad', 'عمر زياد'); // no appointment today
    addAppt({ id: 'a1', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:00:00Z') });
    addAppt({ id: 'a2', patientId: 'pat-2', startsAt: new Date('2026-06-10T11:00:00Z') });
    addAppt({ id: 'a3', patientId: 'pat-3', startsAt: new Date('2026-06-12T11:00:00Z') }); // other day
  });

  it("returns today's full arrivable list sorted by next appointment time, both scripts, no phone", async () => {
    const res = await listTodaysArrivablePatients({ now: NOW });
    expect(res.map((r) => r.patientId)).toEqual(['pat-1', 'pat-2']);
    expect(res[0]).toMatchObject({
      fullNameEn: 'Abdullah Khalil',
      fullNameAr: 'عبدالله خليل',
      checkedIn: false,
    });
    expect(res[0]!.appointments[0]).toMatchObject({ id: 'a1', durationMinutes: 30 });
    expect(JSON.stringify(res)).not.toContain('phone');
  });

  it('excludes patients whose appointment is on another day', async () => {
    const res = await listTodaysArrivablePatients({ now: NOW });
    expect(res.some((r) => r.patientId === 'pat-3')).toBe(false);
  });

  it('excludes cancelled / completed appointments (status filter)', async () => {
    addPatient('pat-7', 'Sami Musa', 'سامي موسى');
    addAppt({
      id: 'c7',
      patientId: 'pat-7',
      startsAt: new Date('2026-06-10T12:00:00Z'),
      status: 'CANCELLED',
    });
    addAppt({
      id: 'd7',
      patientId: 'pat-7',
      startsAt: new Date('2026-06-10T13:00:00Z'),
      status: 'COMPLETED',
    });
    const res = await listTodaysArrivablePatients({ now: NOW });
    expect(res.some((r) => r.patientId === 'pat-7')).toBe(false);
  });

  it('a patient whose only appointment already ENDED has no card (Prompt 31 §4.4)', async () => {
    addPatient('pat-9', 'Layla Hamdan', 'ليلى حمدان');
    // 05:00Z + 30min ends 05:30Z — before NOW (09:00Z), same clinic day.
    addAppt({ id: 'a9', patientId: 'pat-9', startsAt: new Date('2026-06-10T05:00:00Z') });
    const res = await listTodaysArrivablePatients({ now: NOW });
    expect(res.some((r) => r.patientId === 'pat-9')).toBe(false);
  });

  it('drops only the ended appointment when the patient has another arrivable one', async () => {
    addPatient('pat-8', 'Rami Odeh', 'رامي عودة');
    addAppt({ id: 'gone8', patientId: 'pat-8', startsAt: new Date('2026-06-10T05:00:00Z') });
    addAppt({ id: 'next8', patientId: 'pat-8', startsAt: new Date('2026-06-10T12:00:00Z') });
    const res = await listTodaysArrivablePatients({ now: NOW });
    const rami = res.find((r) => r.patientId === 'pat-8');
    expect(rami?.appointments.map((a) => a.id)).toEqual(['next8']);
    expect(rami?.checkedIn).toBe(false);
  });

  it('fully-checked-in patients STAY on the grid with checkedIn=true (✓ card state)', async () => {
    addAppt({
      id: 'a1b',
      patientId: 'pat-1',
      startsAt: new Date('2026-06-10T10:30:00Z'),
      checkedInAt: NOW,
    });
    state.appts.find((a) => a.id === 'a1')!.checkedInAt = NOW;
    const res = await listTodaysArrivablePatients({ now: NOW });
    const p1 = res.find((r) => r.patientId === 'pat-1');
    expect(p1?.checkedIn).toBe(true);
    // Partially-checked-in stays actionable.
    expect(res.find((r) => r.patientId === 'pat-2')?.checkedIn).toBe(false);
  });

  it('handles a busy day: 40 patients all listed, time-sorted (grid-scale fixture)', async () => {
    state.users = [];
    state.appts = [];
    for (let i = 0; i < 40; i++) {
      addPatient(`bulk-${i}`, `Patient ${String(i).padStart(2, '0')}`, `مريض ${i}`);
      // Spread 10:00Z..19:45Z in 15-min steps, inserted in reverse order.
      const start = new Date(Date.UTC(2026, 5, 10, 10, 0));
      start.setUTCMinutes(start.getUTCMinutes() + (39 - i) * 15);
      addAppt({ id: `bulk-a-${i}`, patientId: `bulk-${i}`, startsAt: start });
    }
    const res = await listTodaysArrivablePatients({ now: NOW });
    expect(res).toHaveLength(40);
    const times = res.map((r) => new Date(r.appointments[0]!.startsAtIso).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('recordCheckIn (staff manual)', () => {
  it('marks via STAFF with the staff member as the audit actor', async () => {
    addAppt({ id: 'appt-1', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:00:00Z') });
    await recordCheckIn({
      appointmentId: 'appt-1',
      via: CheckInVia.STAFF,
      actorId: 'sec-1',
      at: NOW,
    });
    expect(state.appts[0]!.checkedInVia).toBe('STAFF');
    expect(state.audits).toEqual([{ actorId: 'sec-1', entityId: 'appt-1' }]);
  });
});
