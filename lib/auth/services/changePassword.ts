import { AuditAction } from '@prisma/client';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { withAudit } from '@/lib/audit/withAudit';
import { hashPassword, passwordSchema, verifyPassword } from '@/lib/auth/password';
import { AUTH_ERRORS } from '@/lib/auth/result';
import { z } from 'zod';

/**
 * Authenticated password-change service.
 *
 * Lives in `services/` rather than `actions/` because it carries a class
 * (`ChangePasswordError`) and the `withAudit` decorator — Next.js 'use server'
 * files may only export async functions, so the action facade in
 * `actions/password.ts` imports this and adapts the throw/return surface
 * into a Result.
 *
 * Wrapped with `withAudit` so every successful password change writes an
 * AuditLog row. The 'after' snapshot is the synthetic marker
 * `{ event: 'PASSWORD_CHANGED' }` — never the new hash.
 */
const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export class ChangePasswordError extends Error {
  constructor(public readonly error: (typeof AUTH_ERRORS)[keyof typeof AUTH_ERRORS]) {
    super(error.message_en);
    this.name = 'ChangePasswordError';
  }
}

type ChangePasswordArgs = [input: { currentPassword: string; newPassword: string }];

export const changePassword = withAudit<ChangePasswordArgs, { userId: string }>(
  {
    entityType: 'User',
    action: AuditAction.UPDATE,
    extractEntityId: (_args, result) => result.userId,
    extractAfter: () => ({ event: 'PASSWORD_CHANGED' }),
  },
  async function changePasswordInner(input): Promise<{ userId: string }> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const code = parsed.error.issues.find((i) => i.message === 'WEAK_PASSWORD')
        ? AUTH_ERRORS.WEAK_PASSWORD
        : AUTH_ERRORS.INVALID_CREDENTIALS;
      throw new ChangePasswordError(code);
    }

    const session = await auth();
    if (!session?.user) throw new ChangePasswordError(AUTH_ERRORS.UNAUTHENTICATED);

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, passwordHash: true },
    });
    if (!user?.passwordHash) throw new ChangePasswordError(AUTH_ERRORS.INVALID_CREDENTIALS);

    const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!ok) throw new ChangePasswordError(AUTH_ERRORS.INVALID_CREDENTIALS);

    const newHash = await hashPassword(parsed.data.newPassword);
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });
    return { userId: user.id };
  },
);
