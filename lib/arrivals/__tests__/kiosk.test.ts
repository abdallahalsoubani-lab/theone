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
        // searchTodaysPatients: name-contains among today's appointment-holders.
        findMany: vi.fn(
          async ({
            where,
            take,
          }: {
            where: {
              OR: Array<{ fullNameEn?: { contains: string }; fullNameAr?: { contains: string } }>;
              appointmentsAsPatient: { some: { startsAt: { gte: Date; lt: Date } } };
            };
            take: number;
          }) => {
            const win = where.appointmentsAsPatient.some.startsAt;
            const en = where.OR.find((o) => o.fullNameEn)?.fullNameEn?.contains ?? '';
            const ar = where.OR.find((o) => o.fullNameAr)?.fullNameAr?.contains ?? '';
            const matched = state.users.filter((u) => {
              if (u.deletedAt) return false;
              const nameHit =
                (en && u.fullNameEn.toLowerCase().includes(en.toLowerCase())) ||
                (ar && u.fullNameAr.includes(ar));
              if (!nameHit) return false;
              return state.appts.some((a) => a.patientId === u.id && inWindow(a, win));
            });
            return matched.slice(0, take).map((u) => ({
              id: u.id,
              fullNameEn: u.fullNameEn,
              fullNameAr: u.fullNameAr,
              appointmentsAsPatient: state.appts
                .filter((a) => a.patientId === u.id && inWindow(a, win))
                .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())
                .map((a) => ({
                  id: a.id,
                  startsAt: a.startsAt,
                  durationMinutes: a.durationMinutes,
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

import { checkInByName, recordCheckIn, searchTodaysPatients } from '../kiosk';

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

describe('checkInByName — passed appointment (Prompt 22 §4.3)', () => {
  const LATE_NOW = new Date('2026-06-10T14:00:00Z');
  it('records the arrival but returns APPOINTMENT_PASSED', async () => {
    addPatient('pat-1', 'Abdullah', 'عبدالله');
    addAppt({ id: 'appt-1', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:00:00Z') });
    const res = await checkInByName({ patientId: 'pat-1', now: LATE_NOW });
    expect(res).toEqual({
      kind: 'APPOINTMENT_PASSED',
      firstName: 'Abdullah',
      startsAtIso: '2026-06-10T10:00:00.000Z',
    });
    expect(state.appts[0]!.checkedInAt).toEqual(LATE_NOW);
  });
});

describe('searchTodaysPatients (July #1 — privacy)', () => {
  beforeEach(() => {
    addPatient('pat-1', 'Abdullah Khalil', 'عبدالله خليل');
    addPatient('pat-2', 'Abeer Nasser', 'عبير ناصر');
    addPatient('pat-3', 'Omar Ziad', 'عمر زياد'); // no appointment today
    addAppt({ id: 'a1', patientId: 'pat-1', startsAt: new Date('2026-06-10T10:00:00Z') });
    addAppt({ id: 'a2', patientId: 'pat-2', startsAt: new Date('2026-06-10T11:00:00Z') });
    addAppt({ id: 'a3', patientId: 'pat-3', startsAt: new Date('2026-06-12T11:00:00Z') }); // other day
  });

  it('returns NOTHING for a query shorter than the minimum (no full-list reveal)', async () => {
    expect(await searchTodaysPatients({ query: 'a', now: NOW })).toEqual([]);
    expect(await searchTodaysPatients({ query: '', now: NOW })).toEqual([]);
  });

  it('matches on the English name and returns both scripts + appointment times, no phone', async () => {
    const res = await searchTodaysPatients({ query: 'Abd', now: NOW });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      patientId: 'pat-1',
      fullNameEn: 'Abdullah Khalil',
      fullNameAr: 'عبدالله خليل',
    });
    expect(res[0]!.appointments[0]).toMatchObject({ id: 'a1', durationMinutes: 30 });
    expect(JSON.stringify(res)).not.toContain('phone');
  });

  it('matches on the Arabic name', async () => {
    const res = await searchTodaysPatients({ query: 'عبير', now: NOW });
    expect(res.map((r) => r.patientId)).toEqual(['pat-2']);
  });

  it('excludes patients with no appointment today', async () => {
    const res = await searchTodaysPatients({ query: 'Omar', now: NOW });
    expect(res).toEqual([]);
  });

  it('an unknown name returns an empty list (generic negative)', async () => {
    expect(await searchTodaysPatients({ query: 'Zzzz', now: NOW })).toEqual([]);
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
