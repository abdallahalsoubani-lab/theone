import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));

vi.mock('@/lib/db', () => {
  type Appt = {
    id: string;
    patientId: string;
    startsAt: Date;
    status: string;
    checkedInAt: Date | null;
    checkedInVia: string | null;
  };
  const state = {
    settings: { timezone: 'Asia/Amman', currentDelayMinutes: 10 },
    users: [] as Array<{ id: string; phone: string; fullNameEn: string; fullNameAr: string }>,
    appts: [] as Appt[],
    audits: [] as Array<{ actorId: string; entityId: string }>,
  };
  return {
    __state: state,
    db: {
      clinicSettings: { findUnique: vi.fn(async () => state.settings) },
      user: {
        findFirst: vi.fn(async ({ where }: { where: { phone: string } }) => {
          const u = state.users.find((x) => x.phone === where.phone);
          return u ?? null;
        }),
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
                  a.startsAt.getTime() >= where.startsAt.gte.getTime() &&
                  a.startsAt.getTime() < where.startsAt.lt.getTime() &&
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

import { checkInByPhone, recordCheckIn } from '../kiosk';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (dbModule as any).__state as {
  settings: { timezone: string; currentDelayMinutes: number };
  users: Array<{ id: string; phone: string; fullNameEn: string; fullNameAr: string }>;
  appts: Array<{
    id: string;
    patientId: string;
    startsAt: Date;
    status: string;
    checkedInAt: Date | null;
    checkedInVia: string | null;
  }>;
  audits: Array<{ actorId: string; entityId: string }>;
};

// Fixed reference instant: 2026-06-10 12:00 Amman (09:00Z). Clinic day window
// is 2026-06-09T21:00Z .. 2026-06-10T21:00Z.
const NOW = new Date('2026-06-10T09:00:00Z');
const PHONE = '+962790123456';

function seedPatientWithAppt(over?: Partial<(typeof state.appts)[number]>) {
  state.users.push({
    id: 'pat-1',
    phone: PHONE,
    fullNameEn: 'Abdullah Khalil',
    fullNameAr: 'عبدالله خليل',
  });
  state.appts.push({
    id: 'appt-1',
    patientId: 'pat-1',
    startsAt: new Date('2026-06-10T10:00:00Z'),
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

describe('checkInByPhone', () => {
  it('checks in a known phone with a today appointment (audited, via KIOSK)', async () => {
    seedPatientWithAppt();
    const res = await checkInByPhone({ phone: '0790123456', now: NOW });
    expect(res).toEqual({ kind: 'CHECKED_IN', firstName: 'Abdullah', delayMinutes: 10 });
    expect(state.appts[0]!.checkedInAt).toEqual(NOW);
    expect(state.appts[0]!.checkedInVia).toBe('KIOSK');
    // Actor is the patient themselves.
    expect(state.audits).toEqual([{ actorId: 'pat-1', entityId: 'appt-1' }]);
  });

  it('returns the generic NO_APPOINTMENT for an unknown phone (nothing written)', async () => {
    const res = await checkInByPhone({ phone: '0799999999', now: NOW });
    expect(res).toEqual({ kind: 'NO_APPOINTMENT' });
    expect(state.audits).toHaveLength(0);
  });

  it('returns NO_APPOINTMENT when the patient has no appointment today', async () => {
    state.users.push({ id: 'pat-1', phone: PHONE, fullNameEn: 'Abdullah', fullNameAr: 'عبدالله' });
    state.appts.push({
      id: 'appt-x',
      patientId: 'pat-1',
      startsAt: new Date('2026-06-12T10:00:00Z'), // different day
      status: 'CONFIRMED',
      checkedInAt: null,
      checkedInVia: null,
    });
    const res = await checkInByPhone({ phone: PHONE, now: NOW });
    expect(res).toEqual({ kind: 'NO_APPOINTMENT' });
  });

  it('reports ALREADY_CHECKED_IN on a second submit (no second write)', async () => {
    seedPatientWithAppt({ checkedInAt: new Date('2026-06-10T08:30:00Z'), checkedInVia: 'KIOSK' });
    const res = await checkInByPhone({ phone: PHONE, now: NOW });
    expect(res.kind).toBe('ALREADY_CHECKED_IN');
    expect(state.audits).toHaveLength(0);
  });

  it('checks into the NEXT UPCOMING appointment when there are two today', async () => {
    state.users.push({ id: 'pat-1', phone: PHONE, fullNameEn: 'Abdullah', fullNameAr: 'عبدالله' });
    state.appts.push(
      {
        id: 'late',
        patientId: 'pat-1',
        startsAt: new Date('2026-06-10T12:00:00Z'),
        status: 'CONFIRMED',
        checkedInAt: null,
        checkedInVia: null,
      },
      {
        id: 'early',
        patientId: 'pat-1',
        startsAt: new Date('2026-06-10T10:00:00Z'),
        status: 'SCHEDULED',
        checkedInAt: null,
        checkedInVia: null,
      },
    );
    const res = await checkInByPhone({ phone: PHONE, now: NOW });
    expect(res.kind).toBe('CHECKED_IN');
    expect(state.appts.find((a) => a.id === 'early')!.checkedInAt).toEqual(NOW);
    expect(state.appts.find((a) => a.id === 'late')!.checkedInAt).toBeNull();
  });

  it('rejects an invalid phone shape generically', async () => {
    seedPatientWithAppt();
    const res = await checkInByPhone({ phone: 'not-a-phone', now: NOW });
    expect(res).toEqual({ kind: 'NO_APPOINTMENT' });
  });

  it('reflects the live currentDelayMinutes setting in the result', async () => {
    seedPatientWithAppt();
    state.settings.currentDelayMinutes = 25;
    const res = await checkInByPhone({ phone: PHONE, now: NOW });
    expect(res).toMatchObject({ kind: 'CHECKED_IN', delayMinutes: 25 });
  });
});

describe('recordCheckIn (staff manual)', () => {
  it('marks via STAFF with the staff member as the audit actor', async () => {
    state.appts.push({
      id: 'appt-1',
      patientId: 'pat-1',
      startsAt: new Date('2026-06-10T10:00:00Z'),
      status: 'CONFIRMED',
      checkedInAt: null,
      checkedInVia: null,
    });
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
