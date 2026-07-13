import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requirePermissionMock, createServiceMock, updateServiceMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(async () => ({ id: 'admin-1', role: 'ADMIN' })),
  createServiceMock: vi.fn(async () => ({ id: 'q-new' })),
  updateServiceMock: vi.fn(async () => ({ id: 'q-1' })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac/guards', () => ({ requirePermission: requirePermissionMock }));
vi.mock('../services', () => ({
  createCustomQuestion: createServiceMock,
  updateCustomQuestion: updateServiceMock,
  reorderCustomQuestions: vi.fn(async () => ({ count: 0 })),
  deactivateCustomQuestion: vi.fn(async () => ({ id: 'q-1' })),
  deleteCustomQuestion: vi.fn(async () => ({ id: 'q-1' })),
  customQuestionToLocalized: (e: unknown) => ({
    code: 'CUSTOM_Q_INVALID',
    message_en: 'Invalid input.',
    message_ar: 'مدخلات غير صالحة.',
    details: e,
  }),
}));

import { createCustomQuestionAction, updateCustomQuestionAction } from '../actions';
import type { CustomQuestionCreateInput } from '../schemas';

const VALID: CustomQuestionCreateInput = {
  nameEn: 'Color',
  nameAr: 'لون',
  type: 'SINGLE_SELECT',
  appliesTo: 'BOTH',
  required: false,
  active: true,
  options: [
    { value: 'a', valueEn: 'A', valueAr: 'أ' },
    { value: 'b', valueEn: 'B', valueAr: 'ب' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' });
});

describe('createCustomQuestionAction — RBAC gate', () => {
  it("requires 'users.update' before doing anything", async () => {
    const res = await createCustomQuestionAction(VALID);
    expect(res.ok).toBe(true);
    expect(requirePermissionMock).toHaveBeenCalledWith('users.update');
  });

  it('denies a caller without the permission and never reaches the service', async () => {
    requirePermissionMock.mockRejectedValueOnce(new Error('FORBIDDEN'));
    await expect(createCustomQuestionAction(VALID)).rejects.toThrow('FORBIDDEN');
    expect(createServiceMock).not.toHaveBeenCalled();
  });
});

describe('createCustomQuestionAction — server-side min-2 enforcement (QA Prompt-22 §7.2)', () => {
  it('returns a fail Result (not a throw) for a select question with < 2 options', async () => {
    const res = await createCustomQuestionAction({ ...VALID, options: [VALID.options[0]!] });
    expect(res.ok).toBe(false);
    expect(createServiceMock).not.toHaveBeenCalled();
  });

  it('rejects even when the client-side resolver was bypassed entirely (0 options)', async () => {
    const res = await createCustomQuestionAction({
      ...VALID,
      type: 'MULTI_SELECT',
      options: [],
    });
    expect(res.ok).toBe(false);
    expect(createServiceMock).not.toHaveBeenCalled();
  });
});

describe('updateCustomQuestionAction — same gate on the edit path', () => {
  it('denies without permission', async () => {
    requirePermissionMock.mockRejectedValueOnce(new Error('FORBIDDEN'));
    await expect(updateCustomQuestionAction({ ...VALID, id: 'q-1' })).rejects.toThrow('FORBIDDEN');
    expect(updateServiceMock).not.toHaveBeenCalled();
  });

  it('returns a fail Result for < 2 options', async () => {
    const res = await updateCustomQuestionAction({ ...VALID, id: 'q-1', options: [] });
    expect(res.ok).toBe(false);
    expect(updateServiceMock).not.toHaveBeenCalled();
  });
});
