import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PT-B2 item 1 — the approved-program read.
 *
 * The rule the owner set: what a patient is told to do is ONLY ever the
 * doctor-approved program. A therapist's draft lives in the builder and must
 * never surface as the patient's program — not in the patient portal, not in
 * the patient-file tab any staff member opens, not in the exported PDF. Every
 * one of those now goes through `getVisibleHomeProgram`, so this suite is the
 * gate's contract.
 */

const { findUniqueMock, findManyMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    homeProgramApproval: { findUnique: findUniqueMock },
    homeProgramItem: { findMany: findManyMock },
  },
}));

import { getVisibleHomeProgram, getVisibleTodayItems } from '../visible';

/** A live builder row, shaped as `listHomeProgramForPatient` selects it. */
function liveItem(over: { id: string; daysOfWeek?: number[]; active?: boolean }) {
  return {
    id: over.id,
    patientId: 'p1',
    exerciseId: 'e1',
    exercise: {
      nameEn: 'Bridge',
      nameAr: 'الجسر',
      videoUrl: null,
      imageUrl: null,
      descriptionEn: 'Bridge',
      descriptionAr: 'الجسر',
      defaultInstructionEn: null,
      defaultInstructionAr: null,
    },
    daysOfWeek: over.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
    scheduledTime: '09:00',
    durationMinutes: 10,
    setsReps: null,
    therapistNote: null,
    active: over.active ?? true,
    reminderJobKey: null,
    createdAt: new Date('2026-06-01T09:00:00Z'),
  };
}

/** A frozen snapshot row, as `buildSnapshot` stores it (createdAt is an ISO string). */
function snapshotItem(id: string) {
  return { ...liveItem({ id }), createdAt: '2026-05-01T09:00:00.000Z' };
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyMock.mockResolvedValue([liveItem({ id: 'live-1' }), liveItem({ id: 'live-2' })]);
});

describe('getVisibleHomeProgram', () => {
  it('shows nothing when the program was never approved', async () => {
    // The therapist added exercises but never submitted: the items exist in
    // the builder, yet the patient has no program.
    findUniqueMock.mockResolvedValue({ status: 'DRAFT', approvedSnapshot: null });
    expect(await getVisibleHomeProgram('p1')).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('shows nothing when there is no approval row at all', async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await getVisibleHomeProgram('p1')).toEqual([]);
  });

  it('shows the live items once the program is APPROVED', async () => {
    findUniqueMock.mockResolvedValue({ status: 'APPROVED', approvedSnapshot: null });
    const items = await getVisibleHomeProgram('p1');
    expect(items.map((i) => i.id)).toEqual(['live-1', 'live-2']);
  });

  it.each(['PENDING_APPROVAL', 'CHANGES_REQUESTED', 'DRAFT'])(
    'keeps showing the last approved snapshot while status is %s',
    async (status) => {
      // The therapist is revising an already-approved program: the patient
      // must keep following the approved content, not the work in progress.
      findUniqueMock.mockResolvedValue({
        status,
        approvedSnapshot: [snapshotItem('approved-1')],
      });
      const items = await getVisibleHomeProgram('p1');
      expect(items.map((i) => i.id)).toEqual(['approved-1']);
      expect(findManyMock).not.toHaveBeenCalled();
      // Dates survive the JSON round trip.
      expect(items[0]!.createdAt).toBeInstanceOf(Date);
    },
  );
});

describe('getVisibleTodayItems', () => {
  const sunday = new Date('2026-08-09T08:00:00Z'); // getUTCDay() === 0

  it('filters the approved program to today and skips paused items', async () => {
    findUniqueMock.mockResolvedValue({ status: 'APPROVED', approvedSnapshot: null });
    findManyMock.mockResolvedValue([
      liveItem({ id: 'today', daysOfWeek: [0] }),
      liveItem({ id: 'other-day', daysOfWeek: [3] }),
      liveItem({ id: 'paused-today', daysOfWeek: [0], active: false }),
    ]);
    const items = await getVisibleTodayItems('p1', sunday);
    expect(items.map((i) => i.id)).toEqual(['today']);
  });

  it('is empty while the program is only a draft', async () => {
    findUniqueMock.mockResolvedValue({ status: 'DRAFT', approvedSnapshot: null });
    expect(await getVisibleTodayItems('p1', sunday)).toEqual([]);
  });
});
