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

describe('per-row booking type (Prompt 51) — SESSION + STRETCHING only, same rules as the single modal', () => {
  const messages = (input: unknown) => {
    const r = seriesBatchCreateSchema.safeParse(input);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
  };

  it("defaults a row without a type to SESSION (today's behaviour preserved)", () => {
    const r = seriesBatchCreateSchema.safeParse(batch([row()]));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rows[0]!.appointmentType).toBe('SESSION');
  });

  it('accepts a STRETCHING row with a room and zero therapists', () => {
    const r = seriesBatchCreateSchema.safeParse(
      batch([row({ appointmentType: 'STRETCHING', therapistIds: [] })]),
    );
    expect(r.success).toBe(true);
  });

  it('rejects a STRETCHING row with a therapist — same message as the single modal', () => {
    expect(messages(batch([row({ appointmentType: 'STRETCHING' })]))).toContain(
      'rows.0.therapistIds:stretchingNoTherapist',
    );
  });

  it('rejects a SESSION row with zero therapists — same message as the single modal', () => {
    expect(messages(batch([row({ therapistIds: [] })]))).toContain(
      'rows.0.therapistIds:therapistRequired',
    );
  });

  it('a STRETCHING row still requires its room', () => {
    expect(
      seriesBatchCreateSchema.safeParse(
        batch([row({ appointmentType: 'STRETCHING', therapistIds: [], roomId: '' })]),
      ).success,
    ).toBe(false);
  });

  it('EVENT and GROUP are NOT accepted row types from this modal (server-side)', () => {
    expect(
      seriesBatchCreateSchema.safeParse(batch([row({ appointmentType: 'EVENT' })])).success,
    ).toBe(false);
    expect(
      seriesBatchCreateSchema.safeParse(
        batch([row({ appointmentType: 'GROUP', therapistIds: ['t1'] })]),
      ).success,
    ).toBe(false);
  });

  it('accepts a mixed SESSION + STRETCHING batch (different times, one patient)', () => {
    const a = row();
    const b = row({
      startsAt: new Date('2030-01-06T12:00:00Z'),
      appointmentType: 'STRETCHING',
      therapistIds: [],
      roomId: 'r2',
    });
    expect(seriesBatchCreateSchema.safeParse(batch([a, b])).success).toBe(true);
  });
});

describe('modal option sets (Prompt 51 — regression guards)', () => {
  const read = async (rel: string) => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(process.cwd(), rel), 'utf8');
  };

  it('the batch row type field offers exactly SESSION + STRETCHING (no EVENT / GROUP option)', async () => {
    const src = await read('components/appointments/BatchRowTypeFields.tsx');
    expect(src).toContain('BATCH_ROW_TYPES');
    expect(src).not.toContain('AppointmentType.EVENT');
    expect(src).not.toContain('AppointmentType.GROUP');
    expect(src).not.toContain("'EVENT'");
  });

  it('the SINGLE booking modal still offers SESSION + STRETCHING + EVENT (EVENT not removed there)', async () => {
    const src = await read('components/appointments/CreateAppointmentModal.tsx');
    expect(src).toContain('<option value="SESSION:THERAPIST">');
    expect(src).toContain('<option value={AppointmentType.STRETCHING}>');
    expect(src).toContain('<option value={AppointmentType.EVENT}>');
  });
});
