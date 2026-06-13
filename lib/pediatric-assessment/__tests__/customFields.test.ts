import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/db', () => ({
  db: { pediatricCustomField: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import {
  listActiveCustomFields,
  listAllCustomFields,
  listFieldsForAssessment,
} from '../customFields/queries';

const FIELDS = [
  {
    id: 'f1',
    labelEn: 'A',
    labelAr: 'أ',
    type: 'TEXT',
    options: null,
    section: null,
    order: 1,
    active: true,
  },
  {
    id: 'f2',
    labelEn: 'Reflex X',
    labelAr: 'منعكس X',
    type: 'SINGLE_SELECT',
    options: [{ value: 'a', labelEn: 'A', labelAr: 'أ' }],
    section: null,
    order: 2,
    active: false, // deactivated
  },
];

beforeEach(() => {
  findMany.mockReset();
  findMany.mockImplementation(
    async ({
      where,
    }: {
      where?: { active?: boolean; OR?: Array<{ active?: boolean; id?: { in?: string[] } }> };
    }) => {
      if (!where) return FIELDS;
      if (where.active === true) return FIELDS.filter((f) => f.active);
      if (where.OR) {
        const ids = where.OR.find((o) => o.id)?.id?.in ?? [];
        return FIELDS.filter((f) => f.active || ids.includes(f.id));
      }
      return FIELDS;
    },
  );
});

describe('pediatric custom field queries', () => {
  it('listAllCustomFields returns active + inactive', async () => {
    const r = await listAllCustomFields();
    expect(r.map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('listActiveCustomFields excludes deactivated fields (new forms)', async () => {
    const r = await listActiveCustomFields();
    expect(r.map((f) => f.id)).toEqual(['f1']);
  });

  it('a deactivated field still renders for an assessment that stored a value for it (§7)', async () => {
    const r = await listFieldsForAssessment({ f2: 'a' });
    expect(r.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
    // and its options survive for rendering
    expect(r.find((f) => f.id === 'f2')?.options).toHaveLength(1);
  });

  it('an assessment with no custom values shows only active fields', async () => {
    const r = await listFieldsForAssessment({});
    expect(r.map((f) => f.id)).toEqual(['f1']);
  });
});
