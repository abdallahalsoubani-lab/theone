import { describe, expect, it } from 'vitest';

import { coreAssessmentSchema } from '../coreSchema';
import { STORED_CORE_FIELDS } from '../coreFields';

const valid = {
  schemaVersion: 1,
  date: '2026-06-13',
  historyObservations: 'history notes',
  examObservations: 'exam notes',
};

describe('coreAssessmentSchema', () => {
  it('accepts a minimal valid assessment (required fields only)', () => {
    expect(coreAssessmentSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts valid enum + multi-select + score values', () => {
    const r = coreAssessmentSchema.safeParse({
      ...valid,
      botoxInjection: 'No',
      delivery: 'C-section',
      foot: ['Flat', 'Equines'],
      transSitToStand: 2,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys (strict core)', () => {
    expect(coreAssessmentSchema.safeParse({ ...valid, notACoreField: 'x' }).success).toBe(false);
  });

  it('rejects an out-of-enum value', () => {
    expect(coreAssessmentSchema.safeParse({ ...valid, botoxInjection: 'Maybe' }).success).toBe(
      false,
    );
  });

  it('rejects a multi-select value outside the option set', () => {
    expect(coreAssessmentSchema.safeParse({ ...valid, foot: ['Flat', 'Nope'] }).success).toBe(
      false,
    );
  });

  it('rejects a transition score outside 0–3', () => {
    expect(coreAssessmentSchema.safeParse({ ...valid, transKneeling: 4 }).success).toBe(false);
  });

  it('rejects missing required observations', () => {
    const { historyObservations: _h, ...noHistory } = valid;
    expect(coreAssessmentSchema.safeParse(noHistory).success).toBe(false);
    const { examObservations: _e, ...noExam } = valid;
    expect(coreAssessmentSchema.safeParse(noExam).success).toBe(false);
  });

  it('rejects NICU = Yes without NICU days', () => {
    expect(coreAssessmentSchema.safeParse({ ...valid, nicu: 'Yes' }).success).toBe(false);
  });

  it('accepts NICU = Yes with NICU days', () => {
    expect(coreAssessmentSchema.safeParse({ ...valid, nicu: 'Yes', nicuDays: '5' }).success).toBe(
      true,
    );
  });

  it('accepts NICU = No without days', () => {
    expect(coreAssessmentSchema.safeParse({ ...valid, nicu: 'No' }).success).toBe(true);
  });
});

describe('core fields integrity (§4)', () => {
  it('has 63 stored fields (65 core minus 2 read-only prefilled)', () => {
    expect(STORED_CORE_FIELDS).toHaveLength(63);
  });

  it('keeps option strings verbatim (no spelling "fixes")', () => {
    const hip = STORED_CORE_FIELDS.find((f) => f.key === 'hipSubluxation');
    expect(hip?.options).toContain('yes need hip spika and X Ray');
    const foot = STORED_CORE_FIELDS.find((f) => f.key === 'foot');
    expect(foot?.options).toContain('Equines');
  });
});
