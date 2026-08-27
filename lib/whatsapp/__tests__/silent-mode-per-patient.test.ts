import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P57 §3.6 — message gates are keyed per patient / per appointment, never
 * per phone. A silent-mode hold on child A's reminder must not hold (or be
 * reused for) child B's reminder even though both share the mother's
 * number: each held row is its own outbox entry.
 */
const state = {
  rows: [] as Array<{
    id: string;
    type: string;
    status: string;
    appointmentId: string | null;
    patientId: string | null;
    homeProgramItemId: string | null;
  }>,
};

vi.mock('@/lib/db', () => ({
  db: {
    whatsAppDispatch: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = state.rows.find(
          (r) =>
            r.type === where.type &&
            r.status === where.status &&
            (where.appointmentId === undefined || r.appointmentId === where.appointmentId) &&
            (where.homeProgramItemId === undefined ||
              r.homeProgramItemId === where.homeProgramItemId),
        );
        return found ? { id: found.id } : null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `d-${state.rows.length + 1}`, ...data } as (typeof state.rows)[number];
        state.rows.push(row);
        return { id: row.id };
      }),
    },
    clinicSettings: { findUnique: vi.fn(async () => ({ whatsappSilentMode: false })) },
  },
}));

import { holdForOutbox } from '../silent-mode';

beforeEach(() => {
  state.rows = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('holdForOutbox — per patient, never per phone', () => {
  it('holds for child A and child B on a shared number as two separate rows', async () => {
    const a = await holdForOutbox({
      type: 'REMINDER',
      appointmentId: 'appt-a',
      patientId: 'child-a',
    });
    const b = await holdForOutbox({
      type: 'REMINDER',
      appointmentId: 'appt-b',
      patientId: 'child-b',
    });
    expect(a).not.toBe(b);
    expect(state.rows).toHaveLength(2);
    expect(state.rows.map((r) => r.patientId)).toEqual(['child-a', 'child-b']);
  });

  it('is idempotent per appointment (a re-fired job reuses the pending row) — not across siblings', async () => {
    const a1 = await holdForOutbox({
      type: 'REMINDER',
      appointmentId: 'appt-a',
      patientId: 'child-a',
    });
    const a2 = await holdForOutbox({
      type: 'REMINDER',
      appointmentId: 'appt-a',
      patientId: 'child-a',
    });
    expect(a1).toBe(a2);
    const b = await holdForOutbox({
      type: 'REMINDER',
      appointmentId: 'appt-b',
      patientId: 'child-b',
    });
    expect(b).not.toBe(a1);
    expect(state.rows).toHaveLength(2);
  });
});
