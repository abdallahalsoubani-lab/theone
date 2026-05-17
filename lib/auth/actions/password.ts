'use server';

import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { db } from '@/lib/db';
import { hashPassword, passwordSchema } from '@/lib/auth/password';
import { redis } from '@/lib/redis/client';
import { AUTH_ERRORS, fail, ok, type Result } from '@/lib/auth/result';
import { ChangePasswordError, changePassword } from '@/lib/auth/services/changePassword';

const RESET_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const resetKey = (token: string) => `reset:${token}`;

const emailOrPhoneSchema = z.object({ identifier: z.string().min(3) });
const resetSchema = z.object({ token: z.string().min(32), newPassword: passwordSchema });

export async function requestPasswordReset(input: {
  identifier: string;
}): Promise<Result<{ sent: true }>> {
  const parsed = emailOrPhoneSchema.safeParse(input);
  if (!parsed.success) return ok({ sent: true });

  const id = parsed.data.identifier.trim();
  const user = id.includes('@')
    ? await db.user.findFirst({
        where: { email: id.toLowerCase(), deletedAt: null },
        select: { id: true },
      })
    : await db.user.findFirst({
        where: { phone: id, deletedAt: null },
        select: { id: true },
      });

  if (user) {
    const token = randomBytes(32).toString('hex');
    await redis.set(resetKey(token), user.id, 'EX', RESET_TOKEN_TTL_SECONDS);
    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const link = `${base}/reset-password?token=${token}`;
    console.warn(`[DEV PASSWORD RESET] user=${user.id} link=${link}`);
  }

  return ok({ sent: true });
}

export async function resetPassword(input: {
  token: string;
  newPassword: string;
}): Promise<Result<{ updated: true }>> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    const code = parsed.error.issues.find((i) => i.message === 'WEAK_PASSWORD')
      ? AUTH_ERRORS.WEAK_PASSWORD
      : AUTH_ERRORS.TOKEN_INVALID;
    return fail(code);
  }

  const userId = await redis.get(resetKey(parsed.data.token));
  if (!userId) return fail(AUTH_ERRORS.TOKEN_INVALID);

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  await redis.del(resetKey(parsed.data.token));
  return ok({ updated: true });
}

export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<Result<{ changed: true }>> {
  try {
    await changePassword(input);
    return ok({ changed: true });
  } catch (err) {
    if (err instanceof ChangePasswordError) return fail(err.error);
    throw err;
  }
}
