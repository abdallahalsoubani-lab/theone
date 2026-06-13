import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  const state = {
    settings: { timezone: 'Asia/Amman', currentDelayMinutes: 15 },
    rows: [] as Array<Record<string, unknown>>,
  };
  return {
    __state: state,
    db: {
      clinicSettings: { findUnique: vi.fn(async () => state.settings) },
      appointment: { findMany: vi.fn(async () => state.rows) },
    },
  };
});

import * as dbModule from '@/lib/db';

import { getArrivalsBoard } from '../queries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (dbModule as any).__state as {
  settings: { timezone: string; currentDelayMinutes: number };
  rows: Array<Record<string, unknown>>;
};

const NOW = new Date('2026-06-10T09:00:00Z'); // 12:00 Amman

function row(over: {
  id: string;
  startsAt: string;
  status: string;
  checkedInAt?: string | null;
  via?: 'KIOSK' | 'STAFF' | null;
}) {
  return {
    id: over.id,
    patientId: `pat-${over.id}`,
    startsAt: new Date(over.startsAt),
    checkedInAt: over.checkedInAt ? new Date(over.checkedInAt) : null,
    checkedInVia: over.via ?? null,
    status: over.status,
    patient: { fullNameEn: `Patient ${over.id}`, fullNameAr: `مريض ${over.id}` },
    therapists: [{ therapist: { fullNameEn: 'Layan', fullNameAr: 'ليان' } }],
    room: { name: 'Room 1' },
  };
}

beforeEach(() => {
  state.settings = { timezone: 'Asia/Amman', currentDelayMinutes: 15 };
  state.rows = [];
});

describe('getArrivalsBoard', () => {
  it('derives the three sections from check-in state + status', async () => {
    state.rows = [
      row({
        id: 'w1',
        startsAt: '2026-06-10T10:00:00Z',
        status: 'CONFIRMED',
        checkedInAt: '2026-06-10T08:50:00Z',
      }),
      row({
        id: 'w2',
        startsAt: '2026-06-10T11:00:00Z',
        status: 'SCHEDULED',
        checkedInAt: '2026-06-10T08:40:00Z',
      }),
      row({ id: 's1', startsAt: '2026-06-10T09:00:00Z', status: 'IN_PROGRESS' }),
      row({ id: 'u1', startsAt: '2026-06-10T13:00:00Z', status: 'CONFIRMED' }),
      // Past, not checked in → neither waiting nor up-next (a no-show drifting).
      row({ id: 'past', startsAt: '2026-06-10T08:00:00Z', status: 'SCHEDULED' }),
      // Already completed → excluded everywhere.
      row({ id: 'done', startsAt: '2026-06-10T07:00:00Z', status: 'COMPLETED' }),
    ];

    const board = await getArrivalsBoard({ now: NOW });

    expect(board.currentDelayMinutes).toBe(15);
    // Waiting ordered by arrival time (w2 arrived before w1).
    expect(board.waiting.map((r) => r.appointmentId)).toEqual(['w2', 'w1']);
    expect(board.inSession.map((r) => r.appointmentId)).toEqual(['s1']);
    expect(board.upNext.map((r) => r.appointmentId)).toEqual(['u1']);
  });

  it('serializes NO phone fields anywhere in the payload (lobby display safety)', async () => {
    state.rows = [
      row({
        id: 'w1',
        startsAt: '2026-06-10T10:00:00Z',
        status: 'CONFIRMED',
        checkedInAt: '2026-06-10T08:50:00Z',
      }),
    ];
    const board = await getArrivalsBoard({ now: NOW });
    const serialized = JSON.stringify(board).toLowerCase();
    expect(serialized).not.toContain('phone');
    expect(serialized).not.toContain('+962');
    // Sanity: names ARE present (staff screen).
    expect(serialized).toContain('patient w1');
  });
});
