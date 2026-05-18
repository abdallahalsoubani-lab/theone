import { AppointmentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  const state = {
    appointments: [] as Array<{
      id: string;
      seriesId: string | null;
      startsAt: Date;
      durationMinutes: number;
      patientId: string;
      therapistId: string;
      status: AppointmentStatus;
    }>,
  };
  return {
    __state: state,
    db: {
      appointment: {
        findUnique: vi.fn(async ({ where, select }: { where: { id: string }; select: unknown }) => {
          const row = state.appointments.find((a) => a.id === where.id);
          if (!row) return null;
          void select; // we always return the whole row in the fake
          return row;
        }),
        findMany: vi.fn(
          async ({
            where,
            orderBy,
          }: {
            where: Record<string, unknown>;
            orderBy?: { startsAt: 'asc' | 'desc' };
          }) => {
            let rows = state.appointments.filter((a) => {
              if (a.seriesId !== (where.seriesId as string)) return false;
              const statusWhere = where.status as { in?: AppointmentStatus[] } | undefined;
              if (statusWhere?.in && !statusWhere.in.includes(a.status)) return false;
              const startsAtWhere = where.startsAt as { gte?: Date } | undefined;
              if (startsAtWhere?.gte && a.startsAt < startsAtWhere.gte) return false;
              return true;
            });
            if (orderBy?.startsAt === 'asc') {
              rows = rows.slice().sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
            }
            return rows;
          },
        ),
      },
    },
  };
});

const dbMock = await import('@/lib/db');
const state = (dbMock as unknown as { __state: { appointments: SeriesRow[] } }).__state;
const { selectSeriesOccurrences } = await import('../series');

interface SeriesRow {
  id: string;
  seriesId: string | null;
  startsAt: Date;
  durationMinutes: number;
  patientId: string;
  therapistId: string;
  status: AppointmentStatus;
}

function makeSeries(seriesId: string, count: number, weekStart = '2026-06-01') {
  const base = new Date(`${weekStart}T10:00:00Z`).getTime();
  for (let i = 0; i < count; i++) {
    state.appointments.push({
      id: `${seriesId}-${i + 1}`,
      seriesId,
      startsAt: new Date(base + i * 7 * 24 * 60 * 60 * 1000),
      durationMinutes: 30,
      patientId: 'p1',
      therapistId: 't1',
      status: AppointmentStatus.SCHEDULED,
    });
  }
}

beforeEach(() => {
  state.appointments = [];
});

describe('selectSeriesOccurrences', () => {
  it('ONE returns exactly the target appointment', async () => {
    makeSeries('s1', 5);
    const out = await selectSeriesOccurrences({ appointmentId: 's1-3', mode: 'ONE' });
    expect(out.map((o) => o.id)).toEqual(['s1-3']);
  });

  it('FOLLOWING includes the boundary occurrence (15 of 24 starting at #10)', async () => {
    makeSeries('s24', 24);
    const out = await selectSeriesOccurrences({ appointmentId: 's24-10', mode: 'FOLLOWING' });
    expect(out).toHaveLength(15);
    expect(out[0]!.id).toBe('s24-10');
    expect(out[out.length - 1]!.id).toBe('s24-24');
  });

  it('FOLLOWING from #1 returns the whole series', async () => {
    makeSeries('s8', 8);
    const out = await selectSeriesOccurrences({ appointmentId: 's8-1', mode: 'FOLLOWING' });
    expect(out).toHaveLength(8);
  });

  it('FOLLOWING from the final occurrence returns exactly that one', async () => {
    makeSeries('s5', 5);
    const out = await selectSeriesOccurrences({ appointmentId: 's5-5', mode: 'FOLLOWING' });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('s5-5');
  });

  it('ALL returns every active occurrence regardless of position', async () => {
    makeSeries('s6', 6);
    const out = await selectSeriesOccurrences({ appointmentId: 's6-4', mode: 'ALL' });
    expect(out).toHaveLength(6);
  });

  it('ALL skips terminal-status occurrences (cancelled / completed / no-show)', async () => {
    makeSeries('s4', 4);
    state.appointments[1]!.status = AppointmentStatus.CANCELLED;
    state.appointments[2]!.status = AppointmentStatus.COMPLETED;
    const out = await selectSeriesOccurrences({ appointmentId: 's4-1', mode: 'ALL' });
    expect(out.map((o) => o.id)).toEqual(['s4-1', 's4-4']);
  });

  it('falls back to ONE when the target has no seriesId', async () => {
    state.appointments.push({
      id: 'loner',
      seriesId: null,
      startsAt: new Date(),
      durationMinutes: 30,
      patientId: 'p1',
      therapistId: 't1',
      status: AppointmentStatus.SCHEDULED,
    });
    const out = await selectSeriesOccurrences({ appointmentId: 'loner', mode: 'ALL' });
    expect(out.map((o) => o.id)).toEqual(['loner']);
  });

  it('returns empty when the appointment id is unknown', async () => {
    const out = await selectSeriesOccurrences({ appointmentId: 'missing', mode: 'ALL' });
    expect(out).toEqual([]);
  });
});
