import { describe, expect, it } from 'vitest';

import {
  recurrenceRuleSchema,
  seriesCreateSchema,
  seriesPreviewSchema,
  seriesResolutionSchema,
} from '../schemas';

const validId = 'cl' + 'a'.repeat(23);

describe('recurrenceRuleSchema', () => {
  it('accepts a minimal weekly rule', () => {
    expect(
      recurrenceRuleSchema.safeParse({
        frequency: 'WEEKLY',
        interval: 1,
        byWeekday: ['SUN'],
        count: 4,
      }).success,
    ).toBe(true);
  });

  it('rejects unsupported frequencies (DAILY / MONTHLY not in scope)', () => {
    expect(
      recurrenceRuleSchema.safeParse({
        frequency: 'DAILY',
        interval: 1,
        byWeekday: ['SUN'],
        count: 4,
      }).success,
    ).toBe(false);
  });

  it('caps count at 52 and interval at 8', () => {
    expect(
      recurrenceRuleSchema.safeParse({
        frequency: 'WEEKLY',
        interval: 1,
        byWeekday: ['SUN'],
        count: 53,
      }).success,
    ).toBe(false);
    expect(
      recurrenceRuleSchema.safeParse({
        frequency: 'WEEKLY',
        interval: 9,
        byWeekday: ['SUN'],
        count: 4,
      }).success,
    ).toBe(false);
  });

  it('requires at least one weekday', () => {
    expect(
      recurrenceRuleSchema.safeParse({
        frequency: 'WEEKLY',
        interval: 1,
        byWeekday: [],
        count: 4,
      }).success,
    ).toBe(false);
  });
});

describe('seriesResolutionSchema', () => {
  it('exposes exactly the four user-facing resolutions plus KEEP', () => {
    for (const r of ['KEEP', 'SKIP', 'SHIFT_1D', 'SHIFT_1W', 'OVERRIDE']) {
      expect(seriesResolutionSchema.safeParse(r).success).toBe(true);
    }
    expect(seriesResolutionSchema.safeParse('IGNORE').success).toBe(false);
  });
});

describe('seriesPreviewSchema', () => {
  it('accepts a complete preview payload', () => {
    expect(
      seriesPreviewSchema.safeParse({
        patientId: validId,
        therapistIds: [validId],
        startsAt: new Date(),
        durationMinutes: 30,
        rule: {
          frequency: 'WEEKLY',
          interval: 1,
          byWeekday: ['SUN', 'TUE'],
          count: 4,
        },
      }).success,
    ).toBe(true);
  });
});

describe('seriesCreateSchema', () => {
  it('requires at least one resolution row', () => {
    const r = seriesCreateSchema.safeParse({
      patientId: validId,
      therapistIds: [validId],
      startsAt: new Date(),
      durationMinutes: 30,
      rule: { frequency: 'WEEKLY', interval: 1, byWeekday: ['SUN'], count: 4 },
      resolutions: [],
    });
    expect(r.success).toBe(false);
  });

  it('caps resolutions at 52 rows (matches the expansion cap)', () => {
    const r = seriesCreateSchema.safeParse({
      patientId: validId,
      therapistIds: [validId],
      startsAt: new Date(),
      durationMinutes: 30,
      rule: { frequency: 'WEEKLY', interval: 1, byWeekday: ['SUN'], count: 4 },
      resolutions: Array.from({ length: 53 }, (_, i) => ({
        index: i,
        startsAt: new Date(),
        resolution: 'KEEP',
      })),
    });
    expect(r.success).toBe(false);
  });

  it('accepts an OVERRIDE resolution (action layer enforces the permission)', () => {
    const r = seriesCreateSchema.safeParse({
      patientId: validId,
      therapistIds: [validId],
      startsAt: new Date(),
      durationMinutes: 30,
      rule: { frequency: 'WEEKLY', interval: 1, byWeekday: ['SUN'], count: 2 },
      resolutions: [
        { index: 0, startsAt: new Date(), resolution: 'KEEP' },
        { index: 1, startsAt: new Date(), resolution: 'OVERRIDE' },
      ],
    });
    expect(r.success).toBe(true);
  });
});
