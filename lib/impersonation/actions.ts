'use server';

import { AuditAction } from '@prisma/client';
import { z } from 'zod';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import type { LocalizedError } from '@/lib/db';
import { type Result, fail, ok } from '@/lib/auth/result';

import {
  clearImpersonationCookie,
  readImpersonationCookie,
  setImpersonationCookie,
} from './cookie';

/**
 * Server actions for the Admin Impersonation feature.
 *
 * All mutation rules from Prompt 13 §3.2 are enforced here at the action
 * boundary, not in the UI:
 *   - caller must be Admin
 *   - target must exist and not be Admin
 *   - target must not be soft-deleted
 *   - cannot start a second impersonation while one is already active
 *   - both start and end always write an audit row
 *
 * The cookie is the only state — no database row tracks the active session.
 *
 * Errors return the standard `Result<T, LocalizedError>` shape so the UI
 * can render a localized toast. Audit-write failures never break the user
 * flow (matches `withAudit`'s contract).
 */

const startSchema = z.object({
  targetUserId: z.string().min(1),
});

const IMPERSONATION_ERRORS = {
  UNAUTHENTICATED: {
    code: 'UNAUTHENTICATED',
    message_en: 'Sign-in required.',
    message_ar: 'يلزم تسجيل الدخول.',
  },
  FORBIDDEN_NOT_ADMIN: {
    code: 'FORBIDDEN_NOT_ADMIN',
    message_en: 'Only an administrator can impersonate.',
    message_ar: 'الانتحال متاح للمسؤول فقط.',
  },
  CANNOT_IMPERSONATE_ADMIN: {
    code: 'CANNOT_IMPERSONATE_ADMIN',
    message_en: 'Cannot impersonate another administrator.',
    message_ar: 'لا يمكن انتحال هوية مسؤول آخر.',
  },
  ALREADY_IMPERSONATING: {
    code: 'ALREADY_IMPERSONATING',
    message_en: 'You are already in an impersonation session. Exit it first.',
    message_ar: 'أنت في جلسة انتحال هوية بالفعل. أنهها أولاً.',
  },
  USER_NOT_FOUND: {
    code: 'USER_NOT_FOUND',
    message_en: 'The user to impersonate was not found.',
    message_ar: 'المستخدم المطلوب الانتحال إليه غير موجود.',
  },
  INVALID_INPUT: {
    code: 'INVALID_INPUT',
    message_en: 'Invalid request.',
    message_ar: 'طلب غير صالح.',
  },
} as const satisfies Record<string, LocalizedError>;

export interface StartImpersonationResultData {
  targetRole: 'PATIENT' | 'SECRETARY' | 'DOCTOR' | 'THERAPIST';
  targetUserId: string;
  /** Path the caller should navigate to after success. */
  redirectTo: string;
}

export async function startImpersonationAction(
  input: z.input<typeof startSchema>,
): Promise<Result<StartImpersonationResultData>> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return fail(IMPERSONATION_ERRORS.INVALID_INPUT);

  const session = await auth();
  if (!session?.user) return fail(IMPERSONATION_ERRORS.UNAUTHENTICATED);
  if (session.user.role !== 'ADMIN') return fail(IMPERSONATION_ERRORS.FORBIDDEN_NOT_ADMIN);

  const existing = await readImpersonationCookie();
  if (existing) return fail(IMPERSONATION_ERRORS.ALREADY_IMPERSONATING);

  const target = await db.user.findUnique({
    where: { id: parsed.data.targetUserId, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!target) return fail(IMPERSONATION_ERRORS.USER_NOT_FOUND);
  if (target.role === 'ADMIN') return fail(IMPERSONATION_ERRORS.CANNOT_IMPERSONATE_ADMIN);

  await setImpersonationCookie({
    adminId: session.user.id,
    targetUserId: target.id,
    targetRole: target.role,
  });

  // Audit the start. actorId = the Admin (responsible party);
  // impersonatedUserId = the target so the audit viewer can render the
  // pair correctly without joining back through the cookie.
  try {
    await db.auditLog.create({
      data: {
        actorId: session.user.id,
        impersonatedUserId: target.id,
        entityType: 'User',
        entityId: target.id,
        action: AuditAction.IMPERSONATION_STARTED,
      },
    });
  } catch (err) {
    console.error('[impersonation] failed to write IMPERSONATION_STARTED audit row', err);
  }

  return ok({
    targetUserId: target.id,
    targetRole: target.role as StartImpersonationResultData['targetRole'],
    redirectTo: roleHomePath(target.role),
  });
}

export async function endImpersonationAction(): Promise<Result<{ redirectTo: string }>> {
  const session = await auth();
  if (!session?.user) {
    // Even without a session — wipe the cookie so a refresh doesn't leave
    // a stray client-side token around. The action is otherwise a no-op.
    await clearImpersonationCookie();
    return fail(IMPERSONATION_ERRORS.UNAUTHENTICATED);
  }

  const cookie = await readImpersonationCookie();
  if (cookie && session.user.role === 'ADMIN' && cookie.adminId === session.user.id) {
    try {
      await db.auditLog.create({
        data: {
          actorId: session.user.id,
          impersonatedUserId: cookie.targetUserId,
          entityType: 'User',
          entityId: cookie.targetUserId,
          action: AuditAction.IMPERSONATION_ENDED,
        },
      });
    } catch (err) {
      console.error('[impersonation] failed to write IMPERSONATION_ENDED audit row', err);
    }
  }

  await clearImpersonationCookie();
  return ok({ redirectTo: '/admin/dashboard' });
}

function roleHomePath(role: 'PATIENT' | 'SECRETARY' | 'DOCTOR' | 'THERAPIST' | 'ADMIN'): string {
  switch (role) {
    case 'PATIENT':
      return '/patient/dashboard';
    case 'SECRETARY':
      return '/secretary/calendar';
    case 'DOCTOR':
      return '/doctor/dashboard';
    case 'THERAPIST':
      return '/therapist/dashboard';
    case 'ADMIN':
      // Unreachable — start rejects ADMIN before we get here. Return the
      // admin home as a defensive default rather than throwing.
      return '/admin/dashboard';
  }
}
