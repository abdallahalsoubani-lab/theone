'use server';

import { WaDispatchType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/auth';
import { fail, ok, type Result } from '@/lib/auth/result';
import { toLocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { excludeDispatchEntry, sendOutboxBatch, setSilentMode } from './service';

const typeSchema = z.nativeEnum(WaDispatchType);

const revalidate = () => {
  revalidatePath('/[locale]/(admin)/admin/whatsapp/outbox', 'page');
};

/** Send every pending message of one type (P48 §4.3). Idempotent — a second
 *  press with nothing pending returns count 0 and the UI shows a no-op toast. */
export async function sendOutboxAction(rawType: unknown): Promise<Result<{ count: number }>> {
  await requirePermission('whatsapp.dispatch');
  const parsed = typeSchema.safeParse(rawType);
  if (!parsed.success) {
    return fail({
      code: 'VALIDATION',
      message_en: 'Unknown outbox type.',
      message_ar: 'نوع صندوق صادر غير معروف.',
    });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return fail({
      code: 'UNAUTHENTICATED',
      message_en: 'Sign-in required.',
      message_ar: 'يلزم تسجيل الدخول.',
    });
  }
  try {
    const data = await sendOutboxBatch({ type: parsed.data, adminId: session.user.id });
    revalidate();
    return ok({ count: data.count });
  } catch (err) {
    return fail(toLocalizedError(err));
  }
}

/** Remove one entry from its batch before sending. */
export async function excludeOutboxAction(entryId: string): Promise<Result<{ entryId: string }>> {
  await requirePermission('whatsapp_outbox.exclude');
  const session = await auth();
  if (!session?.user?.id) {
    return fail({
      code: 'UNAUTHENTICATED',
      message_en: 'Sign-in required.',
      message_ar: 'يلزم تسجيل الدخول.',
    });
  }
  try {
    const data = await excludeDispatchEntry({ entryId, adminId: session.user.id });
    revalidate();
    return ok(data);
  } catch (err) {
    if (err instanceof Error && err.message === 'DISPATCH_ENTRY_NOT_PENDING') {
      return fail({
        code: 'DISPATCH_ENTRY_NOT_PENDING',
        message_en: 'This message is no longer pending.',
        message_ar: 'هذه الرسالة لم تعد قيد الانتظار.',
      });
    }
    return fail(toLocalizedError(err));
  }
}

/** P51 — flip the master silent-mode switch (ADMIN-only, audited). */
export async function setSilentModeAction(on: boolean): Promise<Result<{ on: boolean }>> {
  await requirePermission('whatsapp.dispatch');
  const session = await auth();
  if (!session?.user?.id) {
    return fail({
      code: 'UNAUTHENTICATED',
      message_en: 'Sign-in required.',
      message_ar: 'يلزم تسجيل الدخول.',
    });
  }
  try {
    const data = await setSilentMode({ on: Boolean(on), adminId: session.user.id });
    revalidate();
    revalidatePath('/[locale]/(admin)/admin/settings', 'page');
    return ok(data);
  } catch (err) {
    return fail(toLocalizedError(err));
  }
}
