import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addendumHasClinicalContent } from '../schemas';

// withAudit passthrough so we test the inner service directly; auth/db mocked.
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_cfg: unknown, fn: unknown) => fn,
}));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'doc1', role: 'DOCTOR' } })) }));

const created: Array<Record<string, unknown>> = [];
vi.mock('@/lib/db', () => ({
  db: {
    sessionNote: {
      findUnique: vi.fn(async () => ({
        id: 'parent1',
        appointmentId: 'appt1',
        patientId: 'pat1',
        parentNoteId: null,
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'addendum1' };
      }),
    },
  },
  toLocalizedError: (e: unknown) => e,
}));

const { addSessionNoteAddendum } = await import('../services');

beforeEach(() => {
  created.length = 0;
});

describe('addendumHasClinicalContent (Item 3)', () => {
  it('rejects an all-empty addendum (painScore alone is not content)', () => {
    expect(
      addendumHasClinicalContent({
        subjective: '',
        objective: null,
        assessment: '  ',
        plan: '',
        measurements: null,
      }),
    ).toBe(false);
  });

  it('accepts when any SOAP field or measurement has content', () => {
    expect(addendumHasClinicalContent({ subjective: 'pain improving' })).toBe(true);
    expect(addendumHasClinicalContent({ measurements: 'ROM 90°' })).toBe(true);
  });
});

describe('addSessionNoteAddendum (Item 2)', () => {
  it('persists painScore + measurements and attributes the acting clinician', async () => {
    await addSessionNoteAddendum(
      {
        parentNoteId: 'parent1',
        subjective: 'better',
        objective: null,
        assessment: null,
        plan: null,
        painScore: 6,
        measurements: 'ROM 95°',
      },
      { actorId: 'doc1' },
    );
    expect(created).toHaveLength(1);
    const data = created[0]!;
    expect(data.painScore).toBe(6);
    expect(data.measurements).toEqual({ text: 'ROM 95°' });
    // Author is the acting clinician, NOT a System/admin user.
    expect(data.therapistId).toBe('doc1');
    expect(data.parentNoteId).toBe('parent1');
  });
});
