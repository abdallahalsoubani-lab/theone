'use server';

import { revalidatePath } from 'next/cache';

import { fail, ok, type Result } from '@/lib/auth/result';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { requirePermission } from '@/lib/rbac/guards';

import { monthlyReportSaveSchema } from './schemas';
import { monthlyReportToLocalized, saveMonthlyReport } from './services';

/** P64 #11 — save (create or edit) a patient's monthly SOAP report. */
export async function saveMonthlyReportAction(
  input: unknown,
): Promise<Result<{ id: string; created: boolean }>> {
  const viewer = await requirePermission('monthly_reports.write');
  const parsed = monthlyReportSaveSchema.safeParse(input);
  if (!parsed.success) return fail(monthlyReportToLocalized(parsed.error));
  try {
    await ensureCanReadPatient(parsed.data.patientId);
    const r = await saveMonthlyReport(parsed.data, { id: viewer.id, role: viewer.role });
    for (const base of ['therapist', 'doctor', 'secretary', 'admin']) {
      revalidatePath(`/${base}/patients/${parsed.data.patientId}`);
    }
    return ok({ id: r.id, created: r.created });
  } catch (err) {
    return fail(monthlyReportToLocalized(err));
  }
}
