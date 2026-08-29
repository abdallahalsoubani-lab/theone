'use server';

import { WaDispatchType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/auth';
import { fail, ok, type Result } from '@/lib/auth/result';
import { toLocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { excludeDispatchEntry, sendOutboxBatch, sendOutboxSingle, setSilentMode } from './service';

const typeSchema = z.nativeEnum(WaDispatchType);

const revalidate = () => {
  revalidatePath('/[locale]/(admin)/admin/whatsapp/outbox', 'page');
  // P58 — the secretary mirror of the same page.
  revalidatePath('/[locale]/(staff)/secretary/whatsapp/outbox', 'page');
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

/** P58 item 1 — send exactly one held message now; the rest stay parked.
 *  Human-initiated, so it goes out even while silent mode is ON (the same
 *  P51 exemption as the batch Send) and flips no global state. */
export async function sendOutboxSingleAction(
  entryId: string,
): Promise<Result<{ entryId: string }>> {
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
    const data = await sendOutboxSingle({ entryId, adminId: session.user.id });
    revalidate();
    if (data.stale) {
      // P51 §4.5 — went stale between page load and click: marked STALE,
      // never sent. Same rule the batch applies, surfaced per-row here.
      return fail({
        code: 'DISPATCH_ENTRY_STALE',
        message_en:
          'This message outlived its moment (e.g. the appointment already started) — it was marked stale and not sent.',
        message_ar:
          'تجاوزت هذه الرسالة لحظتها (مثلاً بدأ الموعد بالفعل) — عُلِّمت كمنتهية الصلاحية ولم تُرسل.',
      });
    }
    if (!data.sent) {
      return fail({
        code: 'DISPATCH_SEND_FAILED',
        message_en: 'This message could not be sent (the appointment already started).',
        message_ar: 'تعذّر إرسال هذه الرسالة (الموعد بدأ بالفعل).',
      });
    }
    return ok({ entryId: data.entryId });
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

/** P51 — flip the master silent-mode switch (audited). P58: gated by its own
 *  ADMIN-only permission — the secretary now holds `whatsapp.dispatch` for
 *  queue work, but silencing/unsilencing the whole system stays a management
 *  decision (owner boundary, item 2.4). */
export async function setSilentModeAction(on: boolean): Promise<Result<{ on: boolean }>> {
  await requirePermission('whatsapp.silent_mode');
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
