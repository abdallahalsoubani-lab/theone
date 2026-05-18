'use server';

import { revalidatePath } from 'next/cache';

import type { Result } from '@/lib/auth/result';
import type { LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { doctorReviewCreateSchema } from './schemas';
import { createDoctorReview, currentDoctorId, doctorReviewToLocalized } from './services';

export async function createDoctorReviewAction(
  raw: unknown,
): Promise<Result<{ reviewId: string }, LocalizedError>> {
  await requirePermission('doctor_reviews.create');
  const parsed = doctorReviewCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: parsed.error.issues[0]?.message ?? 'Invalid review input.',
        message_ar: 'بيانات المراجعة غير صالحة.',
      },
    };
  }
  try {
    const doctorId = await currentDoctorId();
    const data = await createDoctorReview(parsed.data, { doctorId });
    revalidatePath('/doctor/reports/weekly');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: doctorReviewToLocalized(err) };
  }
}
