import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R-6 (Prompt 42) — recurring day rules, server side. Non-working days come
 * LIVE from ClinicSettings.businessHours (never a hardcoded Fri/Sat): a rule
 * whose byWeekday includes a closed day is rejected up front, in preview AND
 * create, so UI disabling is not the only enforcement. Changing the settings
 * changes the verdict — the settings-driven test below flips a day open.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'actor-1', role: 'SECRETARY' } })),
}));
vi.mock('../conflicts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, checkConflicts: vi.fn(async () => ({ ok: true })) };
});

vi.mock('@/lib/db', () => {
  const state = {
    businessHours: null as Record<string, { open: string; close: string; closed: boolean }> | null,
  };
  return {
    __state: state,
    db: {
      clinicSettings: {
        findUnique: vi.fn(async () => ({ businessHours: state.businessHours })),
      },
    },
    toLocalizedError: (e: unknown) => ({ code: 'X', message_en: String(e), message_ar: '' }),
  };
});

import { createSeries, previewSeries } from '../services';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    businessHours: Record<string, { open: string; close: string; closed: boolean }> | null;
  };
};

const FRI_SAT_CLOSED = {
  sun: { open: '09:00', close: '18:00', closed: false },
  mon: { open: '09:00', close: '18:00', closed: false },
  tue: { open: '09:00', close: '18:00', closed: false },
  wed: { open: '09:00', close: '18:00', closed: false },
  thu: { open: '09:00', close: '18:00', closed: false },
  fri: { open: '09:00', close: '18:00', closed: true },
  sat: { open: '09:00', close: '18:00', closed: true },
};

const futureStart = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  d.setUTCHours(8, 0, 0, 0);
  return d;
};

const preview = (byWeekday: string[]) =>
  previewSeries({
    patientId: 'p1',
    therapistIds: ['t1'],
    roomId: 'r1',
    startsAt: futureStart(),
    durationMinutes: 30,
    rule: { frequency: 'WEEKLY', interval: 1, byWeekday, count: 4 },
  } as Parameters<typeof previewSeries>[0]);

beforeEach(() => {
  __state.businessHours = FRI_SAT_CLOSED;
});

describe('recurring rule vs closed days (R-6 — settings-driven)', () => {
  it('preview rejects a rule containing a closed day (FRI in settings)', async () => {
    await expect(preview(['MON', 'FRI'])).rejects.toMatchObject({
      error: { code: 'SERIES_DAY_CLOSED', details: { closedWeekdays: ['FRI'] } },
    });
  });

  it('create rejects the same crafted rule before booking anything', async () => {
    await expect(
      createSeries({
        patientId: 'p1',
        therapistIds: ['t1'],
        roomId: 'r1',
        startsAt: futureStart(),
        durationMinutes: 30,
        notes: null,
        rule: { frequency: 'WEEKLY', interval: 1, byWeekday: ['SAT'], count: 2 },
        resolutions: [],
      } as unknown as Parameters<typeof createSeries>[0]),
    ).rejects.toMatchObject({ error: { code: 'SERIES_DAY_CLOSED' } });
  });

  it('settings change flips the verdict — FRI opened in admin settings → rule accepted', async () => {
    __state.businessHours = {
      ...FRI_SAT_CLOSED,
      fri: { open: '09:00', close: '18:00', closed: false },
    };
    const r = await preview(['MON', 'FRI']);
    expect(r.occurrences.length).toBeGreaterThan(0);
  });

  it('no configured hours → nothing closed, rule accepted (defensive default)', async () => {
    __state.businessHours = null;
    const r = await preview(['FRI']);
    expect(r.occurrences.length).toBeGreaterThan(0);
  });
});
