import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist-safe mocks. withAudit is reduced to "call the inner fn" so we can invoke
// the wrapped service directly; auth + db are stubbed.
const { create, aggregate } = vi.hoisted(() => ({
  create: vi.fn(async (_args: { data: { options: unknown } }) => ({ id: 'q1' })),
  aggregate: vi.fn(async () => ({ _max: { displayOrder: 0 } })),
}));

vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_meta: unknown, fn: unknown) => fn,
}));
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/db', () => ({
  db: { intakeCustomQuestion: { create, aggregate } },
  toLocalizedError: (e: unknown) => e,
}));
vi.mock('../queries', () => ({ listSelectedOptionValues: vi.fn(async () => new Set()) }));

import { customQuestionCreateSchema } from '../schemas';
import { createCustomQuestion } from '../services';

const OPTIONS = [
  { value: 'a', valueEn: 'A', valueAr: 'أ' },
  { value: 'b', valueEn: 'B', valueAr: 'ب' },
];

beforeEach(() => {
  create.mockClear();
  aggregate.mockClear();
});

describe('custom question select validation (QA retest #3)', () => {
  const base = { nameEn: 'Color', nameAr: 'لون', appliesTo: 'BOTH' as const };

  it('rejects a select field with fewer than 2 options', () => {
    expect(
      customQuestionCreateSchema.safeParse({ ...base, type: 'SINGLE_SELECT', options: [] }).success,
    ).toBe(false);
    expect(
      customQuestionCreateSchema.safeParse({
        ...base,
        type: 'MULTI_SELECT',
        options: [OPTIONS[0]],
      }).success,
    ).toBe(false);
  });

  it('accepts a select field with options, and a TEXT field with none', () => {
    expect(
      customQuestionCreateSchema.safeParse({ ...base, type: 'SINGLE_SELECT', options: OPTIONS })
        .success,
    ).toBe(true);
    expect(customQuestionCreateSchema.safeParse({ ...base, type: 'TEXT' }).success).toBe(true);
  });
});

describe('custom question option persistence (QA retest #3)', () => {
  it('persists the options array for SINGLE_SELECT', async () => {
    await createCustomQuestion({
      nameEn: 'Color',
      nameAr: 'لون',
      type: 'SINGLE_SELECT',
      appliesTo: 'BOTH',
      required: false,
      active: true,
      options: OPTIONS,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data.options).toEqual(OPTIONS);
  });

  it('stores JSON null (not a bare array/undefined) for non-select types', async () => {
    await createCustomQuestion({
      nameEn: 'Notes',
      nameAr: 'ملاحظات',
      type: 'TEXT',
      appliesTo: 'BOTH',
      required: false,
      active: true,
      options: [],
    });
    expect(create.mock.calls[0]![0].data.options).toBe(Prisma.JsonNull);
  });
});
