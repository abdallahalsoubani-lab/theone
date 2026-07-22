import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 37 item 1 — audit under impersonation: the REAL Admin is the
 * recorded actor for every mutation performed while acting as another user,
 * with the impersonated user preserved alongside (impersonatedUserId).
 */

const { effectiveMock, createMock } = vi.hoisted(() => ({
  effectiveMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: (...a: unknown[]) => effectiveMock(...a),
}));
vi.mock('@/lib/db', () => ({ db: { auditLog: { create: createMock } } }));

import { withAudit } from '../withAudit';

beforeEach(() => {
  vi.clearAllMocks();
});

const audited = withAudit<[{ value: number }], { id: string }>(
  {
    entityType: 'Test',
    action: 'UPDATE' as never,
    extractEntityId: (_args, result) => result.id,
  },
  async function inner(input) {
    return { id: `row-${input.value}` };
  },
);

describe('withAudit under Admin impersonation', () => {
  it('records the REAL admin as actor and the target as impersonatedUserId', async () => {
    effectiveMock.mockResolvedValue({
      user: { id: 'therapist-9' },
      isImpersonating: true,
      adminId: 'admin-1',
    });
    await audited({ value: 7 });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'admin-1',
          impersonatedUserId: 'therapist-9',
          entityId: 'row-7',
        }),
      }),
    );
  });

  it('records the user themselves when not impersonating', async () => {
    effectiveMock.mockResolvedValue({
      user: { id: 'doc-1' },
      isImpersonating: false,
      adminId: null,
    });
    await audited({ value: 1 });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: 'doc-1', impersonatedUserId: null }),
      }),
    );
  });
});
