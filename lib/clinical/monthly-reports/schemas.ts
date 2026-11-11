import { z } from 'zod';

/** P64 #11 — the monthly SOAP report. `month` is the clinic month 'YYYY-MM'. */
const soap = z.string().max(5000).optional().nullable();
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthlyReportSaveSchema = z.object({
  patientId: z.string().min(1),
  month: z.string().regex(MONTH_RE),
  subjective: soap,
  objective: soap,
  assessment: soap,
  plan: soap,
});
export type MonthlyReportSaveInput = z.infer<typeof monthlyReportSaveSchema>;

export function hasSoapContent(input: {
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
}): boolean {
  return [input.subjective, input.objective, input.assessment, input.plan].some(
    (v) => (v ?? '').trim().length > 0,
  );
}
