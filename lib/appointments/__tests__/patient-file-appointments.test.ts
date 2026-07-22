import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Patient-file Appointments tab query (Prompt 33 — NI-2). The tab trigger
 * existed since Prompt 6 but rendered a placeholder forever; these tests pin
 * the query that now feeds it: own bookings + GROUP membership via the M2M,
 * no phone anywhere in the shape (Prompt 15 privacy).
 */

interface MockAppt {
  id: string;
  patientId: string | null;
  startsAt: Date;
  durationMinutes: number;
  status: string;
  appointmentType: string;
  title: string | null;
  room: { name: string } | null;
  therapists: Array<{ therapist: { id: string; fullNameEn: string; fullNameAr: string } }>;
  groupPatientIds: string[];
}

vi.mock('@/lib/db', () => {
  const state = { appts: [] as MockAppt[] };
  return {
    __state: state,
    db: {
      appointment: {
        findMany: vi.fn(async ({ where }: { where: { OR: [{ patientId: string }, unknown] } }) => {
          const patientId = where.OR[0].patientId;
          return state.appts
            .filter((a) => a.patientId === patientId || a.groupPatientIds.includes(patientId))
            .sort((x, y) => y.startsAt.getTime() - x.startsAt.getTime());
        }),
      },
    },
  };
});

import * as dbModule from '@/lib/db';

import { listAppointmentsForPatientFile } from '../queries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (dbModule as any).__state as { appts: MockAppt[] };

function addAppt(over: Partial<MockAppt> & Pick<MockAppt, 'id' | 'startsAt'>): void {
  state.appts.push({
    patientId: null,
    durationMinutes: 30,
    status: 'SCHEDULED',
    appointmentType: 'SESSION',
    title: null,
    room: { name: 'Room 1' },
    therapists: [{ therapist: { id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' } }],
    groupPatientIds: [],
    ...over,
  });
}

beforeEach(() => {
  state.appts = [];
});

describe('listAppointmentsForPatientFile', () => {
  it('returns own bookings AND group memberships, newest first', async () => {
    addAppt({ id: 'own', patientId: 'p1', startsAt: new Date('2026-07-20T07:00:00Z') });
    addAppt({
      id: 'grp',
      appointmentType: 'GROUP',
      title: 'Back-care workshop',
      startsAt: new Date('2026-07-25T07:00:00Z'),
      groupPatientIds: ['p1', 'p2'],
    });
    addAppt({ id: 'other', patientId: 'p2', startsAt: new Date('2026-07-21T07:00:00Z') });

    const rows = await listAppointmentsForPatientFile('p1');
    expect(rows.map((r) => r.id)).toEqual(['grp', 'own']);
    expect(rows[0]).toMatchObject({ title: 'Back-care workshop', appointmentType: 'GROUP' });
  });

  it('a multi-therapist appointment appears ONCE with all therapist names', async () => {
    addAppt({
      id: 'multi',
      patientId: 'p1',
      startsAt: new Date('2026-07-22T07:00:00Z'),
      therapists: [
        { therapist: { id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' } },
        { therapist: { id: 't2', fullNameEn: 'Lina', fullNameAr: 'لينا' } },
      ],
    });
    const rows = await listAppointmentsForPatientFile('p1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.therapists.map((t) => t.fullNameEn)).toEqual(['Ahmad', 'Lina']);
  });

  it('the serialized shape carries no phone or contact field (Prompt 15 privacy)', async () => {
    addAppt({ id: 'a', patientId: 'p1', startsAt: new Date('2026-07-22T07:00:00Z') });
    const rows = await listAppointmentsForPatientFile('p1');
    expect(JSON.stringify(rows)).not.toMatch(/phone|email/i);
  });
});
