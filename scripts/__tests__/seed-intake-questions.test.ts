import { describe, expect, it, vi } from 'vitest';

import { IMPORT_QUESTIONS } from '@/lib/intake/import-mapping';

import { runIntakeQuestionSeed } from '../seed-intake-questions';

/** P51 §5 — seed idempotency + dry-run writes nothing (fake client). */

function fakeDb(existingNames: string[] = []) {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<{ id: string; data: Record<string, unknown> }> = [];
  const client = {
    intakeCustomQuestion: {
      findFirst: vi.fn(async ({ where }: { where: { nameAr: string } }) =>
        existingNames.includes(where.nameAr) ? { id: `q-${where.nameAr}` } : null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updated.push({ id: where.id, data });
          return data;
        },
      ),
    },
  };
  return { client: client as never, created, updated };
}

describe('seed-intake-questions', () => {
  it('dry-run writes NOTHING', async () => {
    const { client, created, updated } = fakeDb();
    const r = await runIntakeQuestionSeed(false, client);
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(r).toEqual({ created: 0, updated: 0 });
  });

  it('apply creates all 24 with system authorship and the signed flags', async () => {
    const { client, created } = fakeDb();
    const r = await runIntakeQuestionSeed(true, client);
    expect(r.created).toBe(24);
    expect(created.every((c) => c.createdById === 'system')).toBe(true);
    const archive = created.find((c) => c.active === false)!;
    expect(archive).toMatchObject({ appliesTo: 'BOTH', type: 'TEXTAREA' });
    expect(created.filter((c) => c.active === true)).toHaveLength(23);
    expect(created.filter((c) => c.active === true).every((c) => c.appliesTo === 'PEDIATRIC')).toBe(
      true,
    );
  });

  it('idempotent: existing nameAr rows are UPDATED in place, never duplicated', async () => {
    const existing = IMPORT_QUESTIONS.slice(0, 3).map((q) => q.nameAr);
    const { client, created, updated } = fakeDb(existing);
    const r = await runIntakeQuestionSeed(true, client);
    expect(r).toEqual({ created: 21, updated: 3 });
    expect(created).toHaveLength(21);
    expect(updated).toHaveLength(3);
  });
});
