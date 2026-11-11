import { beforeEach, describe, expect, it, vi } from 'vitest';

/** P64 #11 — monthly SOAP report: one per patient-month, author rules. */

vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_c: unknown, fn: unknown) => fn }));
const assigned = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock('@/lib/patients/assignment', () => ({
  isClinicianAssignedTo: vi.fn(async (c: string, p: string) => assigned.set.has(`${c}:${p}`)),
}));

vi.mock('@/lib/db', () => {
  const state = {
    rows: [] as Array<{
      id: string;
      patientId: string;
      month: string;
      authorId: string;
      subjective: string;
    }>,
  };
  return {
    __state: state,
    toLocalizedError: (e: unknown) => ({ code: 'X', message_en: String(e), message_ar: '' }),
    db: {
      monthlyReport: {
        findUnique: vi.fn(
          async ({ where }: { where: { patientId_month: { patientId: string; month: string } } }) =>
            state.rows.find(
              (r) =>
                r.patientId === where.patientId_month.patientId &&
                r.month === where.patientId_month.month,
            ) ?? null,
        ),
        create: vi.fn(async ({ data }: { data: (typeof state.rows)[number] }) => {
          const row = { ...data, id: `mr${state.rows.length + 1}` };
          state.rows.push(row);
          return { id: row.id };
        }),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: { subjective: string } }) => {
            Object.assign(state.rows.find((r) => r.id === where.id)!, data);
          },
        ),
      },
    },
  };
});

import { saveMonthlyReport } from '../services';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: { rows: Array<{ id: string; authorId: string; subjective: string }> };
};

const NOW = new Date('2026-11-11T09:00:00Z');
const TH = { id: 'th-1', role: 'THERAPIST' as const };
const TH2 = { id: 'th-2', role: 'THERAPIST' as const };
const DR = { id: 'dr-1', role: 'DOCTOR' as const };
const base = { patientId: 'p1', month: '2026-11', subjective: 'better' };

beforeEach(() => {
  __state.rows = [];
  assigned.set = new Set(['th-1:p1', 'th-2:p1']);
});

describe('saveMonthlyReport', () => {
  it('first save creates; second save of the same month edits the same row', async () => {
    const a = await saveMonthlyReport(base, TH, NOW);
    expect(a.created).toBe(true);
    const b = await saveMonthlyReport({ ...base, subjective: 'much better' }, TH, NOW);
    expect(b).toMatchObject({ created: false, id: a.id });
    expect(__state.rows).toHaveLength(1);
    expect(__state.rows[0]!.subjective).toBe('much better');
  });

  it("a colleague cannot edit another therapist's month; a doctor can", async () => {
    await saveMonthlyReport(base, TH, NOW);
    await expect(saveMonthlyReport(base, TH2, NOW)).rejects.toMatchObject({
      error: { code: 'MONTHLY_REPORT_NOT_AUTHOR' },
    });
    await expect(saveMonthlyReport(base, DR, NOW)).resolves.toMatchObject({ created: false });
  });

  it('a therapist outside the care team is refused', async () => {
    assigned.set = new Set();
    await expect(saveMonthlyReport(base, TH, NOW)).rejects.toMatchObject({
      error: { code: 'MONTHLY_REPORT_FORBIDDEN' },
    });
  });

  it('refuses empty reports and future months; past months are fine', async () => {
    await expect(
      saveMonthlyReport({ patientId: 'p1', month: '2026-11', subjective: '  ' }, TH, NOW),
    ).rejects.toMatchObject({ error: { code: 'MONTHLY_REPORT_EMPTY' } });
    await expect(saveMonthlyReport({ ...base, month: '2026-12' }, TH, NOW)).rejects.toMatchObject({
      error: { code: 'MONTHLY_REPORT_FUTURE_MONTH' },
    });
    await expect(saveMonthlyReport({ ...base, month: '2026-09' }, TH, NOW)).resolves.toMatchObject({
      created: true,
    });
  });
});
