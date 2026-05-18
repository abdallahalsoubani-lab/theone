'use server';

import { revalidatePath } from 'next/cache';

import type { Result } from '@/lib/auth/result';
import type { LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { dayReportSubmitSchema } from './schemas';
import { currentTherapistOrAdminId, dayReportToLocalized, submitDayReport } from './services';

export async function submitDayReportAction(
  raw: unknown,
): Promise<Result<{ reportId: string }, LocalizedError>> {
  await requirePermission('reports.submit');
  const parsed = dayReportSubmitSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: parsed.error.issues[0]?.message ?? 'Invalid day-report input.',
        message_ar: 'بيانات التقرير غير صالحة.',
      },
    };
  }
  try {
    const therapistId = await currentTherapistOrAdminId();
    const data = await submitDayReport(parsed.data, { therapistId });
    revalidatePath('/therapist/dashboard');
    revalidatePath('/doctor/reports/weekly');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: dayReportToLocalized(err) };
  }
}
