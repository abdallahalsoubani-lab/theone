import { describe, expect, it } from 'vitest';

import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';

import { customAnswerIssues, withCustomAnswerRules } from '../buildCustomQuestionSchema';
import { adultIntakeSchema } from '../schemas';

function q(over: Partial<CustomQuestionRow>): CustomQuestionRow {
  return {
    id: 'q1',
    nameEn: 'Q',
    nameAr: 'س',
    type: 'TEXT',
    options: [],
    appliesTo: 'ADULT',
    required: true,
    displayOrder: 1,
    active: true,
    answerCount: 0,
    ...over,
  } as CustomQuestionRow;
}

describe('required custom answers (P64 #8)', () => {
  it('flags a missing required answer with the `required` token', () => {
    expect(customAnswerIssues([q({})], {})).toEqual([{ questionId: 'q1', message: 'required' }]);
    expect(customAnswerIssues([q({})], { q1: 'ok' })).toEqual([]);
  });

  it('ignores archived (inactive) and optional questions', () => {
    expect(customAnswerIssues([q({ active: false })], {})).toEqual([]);
    expect(customAnswerIssues([q({ required: false })], {})).toEqual([]);
  });

  it('a required single-select with no choice is `required`, not a raw enum message', () => {
    const sel = q({
      id: 's1',
      type: 'SINGLE_SELECT',
      options: [{ value: 'a', valueEn: 'A', valueAr: 'أ' }],
    });
    expect(customAnswerIssues([sel], {})).toEqual([{ questionId: 's1', message: 'required' }]);
  });

  it('the wrapped form schema pins the error on customAnswers.<id>', () => {
    const schema = withCustomAnswerRules(adultIntakeSchema, [q({})]);
    const r = schema.safeParse({ customAnswers: {} });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(['customAnswers', 'q1']);
    expect(schema.safeParse({ customAnswers: { q1: 'x' } }).success).toBe(true);
  });
});
