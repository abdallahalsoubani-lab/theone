'use server';

import { revalidatePath } from 'next/cache';

import type { Result } from '@/lib/auth/result';
import type { LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import {
  addendumHasClinicalContent,
  sessionNoteAddendumSchema,
  sessionNoteCreateSchema,
  sessionNoteUpdateSchema,
} from './schemas';
import {
  addSessionNoteAddendum,
  createSessionNote,
  currentClinicianId,
  currentTherapistOrAdminId,
  sessionNoteToLocalized,
  updateSessionNote,
} from './services';

export async function createSessionNoteAction(
  raw: unknown,
): Promise<Result<{ noteId: string }, LocalizedError>> {
  await requirePermission('session_notes.create.own', {});
  const parsed = sessionNoteCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: parsed.error.issues[0]?.message ?? 'Invalid session note input.',
        message_ar: 'بيانات ملاحظة الجلسة غير صالحة.',
      },
    };
  }
  try {
    const therapistId = await currentTherapistOrAdminId();
    const data = await createSessionNote(parsed.data, { therapistId });
    revalidatePath('/secretary/calendar');
    revalidatePath('/therapist/dashboard');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: sessionNoteToLocalized(err) };
  }
}

export async function updateSessionNoteAction(
  raw: unknown,
): Promise<Result<{ noteId: string }, LocalizedError>> {
  await requirePermission('session_notes.update.own', {});
  const parsed = sessionNoteUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: parsed.error.issues[0]?.message ?? 'Invalid session note input.',
        message_ar: 'بيانات ملاحظة الجلسة غير صالحة.',
      },
    };
  }
  try {
    const therapistId = await currentTherapistOrAdminId();
    const data = await updateSessionNote(parsed.data, { therapistId });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: sessionNoteToLocalized(err) };
  }
}

export async function addSessionNoteAddendumAction(
  raw: unknown,
): Promise<Result<{ noteId: string }, LocalizedError>> {
  await requirePermission('session_notes.addendum');
  const parsed = sessionNoteAddendumSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: parsed.error.issues[0]?.message ?? 'Invalid addendum input.',
        message_ar: 'بيانات الملاحظة التكميلية غير صالحة.',
      },
    };
  }
  // Reject an empty addendum (Fix 6B item 3) — at least one SOAP field or a
  // measurement is required; painScore alone (defaults to 0) isn't content.
  if (!addendumHasClinicalContent(parsed.data)) {
    return {
      ok: false,
      error: {
        code: 'SESSION_NOTE_ADDENDUM_EMPTY',
        message_en: 'An addendum needs at least one SOAP field or a measurement.',
        message_ar: 'يجب أن تحتوي الملاحظة التكميلية على حقل SOAP واحد على الأقل أو قياس.',
      },
    };
  }
  try {
    const actorId = await currentClinicianId();
    const data = await addSessionNoteAddendum(parsed.data, { actorId });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: sessionNoteToLocalized(err) };
  }
}
