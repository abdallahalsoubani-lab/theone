import { describe, expect, it } from 'vitest';

import { MAX_BATCH_ROWS, seriesBatchCreateSchema } from '../schemas';

/**
 * July 31 item 4 — the explicit multi-row batch schema (replaces the
 * Prompt 7b weekly-pattern schemas). Shape rules, the duplicate-row guard,
 * and the duration-aware same-patient overlap check INSIDE the batch (the
 * Prompt 42 total-block applied to the rows themselves). Past dates and
 * closed days are service/engine checks — see series-batch.test.ts.
 */

const T10 = new Date('2030-01-06T10:00:00Z'); // Sunday
const row = (over: Record<string, unknown> = {}) => ({
  startsAt: T10,
  durationMinutes: 60,
  therapistIds: ['t1'],
  roomId: 'r1',
  ...over,
});
const batch = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  patientId: 'p1',
  rows,
  ...over,
});

describe('seriesBatchCreateSchema — shape', () => {
  it('accepts a single complete row', () => {
    expect(seriesBatchCreateSchema.safeParse(batch([row()])).success).toBe(true);
  });

  it('rejects an empty batch', () => {
    expect(seriesBatchCreateSchema.safeParse(batch([])).success).toBe(false);
  });

  it('rejects more rows than the batch cap', () => {
    const rows = Array.from({ length: MAX_BATCH_ROWS + 1 }, (_, i) =>
      row({ startsAt: new Date(T10.getTime() + i * 24 * 60 * 60 * 1000) }),
    );
    expect(seriesBatchCreateSchema.safeParse(batch(rows)).success).toBe(false);
  });

  it('rejects an incomplete row: missing room / no therapist / short duration', () => {
    expect(seriesBatchCreateSchema.safeParse(batch([row({ roomId: '' })])).success).toBe(false);
    expect(seriesBatchCreateSchema.safeParse(batch([row({ therapistIds: [] })])).success).toBe(
      false,
    );
    // Duration floor = the calendar's 15-minute step (Prompt 26).
    expect(seriesBatchCreateSchema.safeParse(batch([row({ durationMinutes: 10 })])).success).toBe(
      false,
    );
  });

  it('requires a patient', () => {
    expect(seriesBatchCreateSchema.safeParse(batch([row()], { patientId: '' })).success).toBe(
      false,
    );
  });
});

describe('seriesBatchCreateSchema — duplicates + batch-internal overlap', () => {
  it('rejects two identical rows (same instant + room + therapist set)', () => {
    const parsed = seriesBatchCreateSchema.safeParse(batch([row(), row()]));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message === 'duplicateRow')).toBe(true);
    }
  });

  it('rejects same-date overlapping rows even with different therapists/rooms (duration-aware)', () => {
    const parsed = seriesBatchCreateSchema.safeParse(
      batch([
        row(), // 10:00–11:00
        row({
          startsAt: new Date('2030-01-06T10:30:00Z'), // starts inside the first
          therapistIds: ['t2'],
          roomId: 'r2',
        }),
      ]),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message === 'overlappingRows')).toBe(true);
    }
  });

  it('accepts back-to-back rows (end == next start is not an overlap)', () => {
    expect(
      seriesBatchCreateSchema.safeParse(
        batch([row(), row({ startsAt: new Date('2030-01-06T11:00:00Z') })]),
      ).success,
    ).toBe(true);
  });

  it('accepts a valid mixed batch: same date twice at different times, per-row therapists + durations', () => {
    expect(
      seriesBatchCreateSchema.safeParse(
        batch([
          row(), // Sun 10:00, t1, r1, 60m
          row({
            startsAt: new Date('2030-01-06T14:00:00Z'), // same day, later
            therapistIds: ['t2', 't3'], // multi-therapist preserved (Prompt 20)
            durationMinutes: 45,
            roomId: 'r2',
          }),
          row({ startsAt: new Date('2030-01-08T10:00:00Z') }), // another day
        ]),
      ).success,
    ).toBe(true);
  });
});
