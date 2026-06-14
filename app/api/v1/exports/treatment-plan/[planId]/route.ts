import { NextResponse } from 'next/server';

import { getPlanById } from '@/lib/clinical/plans/queries';
import {
  generateTreatmentPlanPdf,
  treatmentPlanErrorToLocalized,
} from '@/lib/exports/treatmentPlan';
import { ensureCanReadPatientStaff } from '@/lib/patients/access';
import { ForbiddenError } from '@/lib/rbac/guards';

/**
 * Treatment plan PDF export (Prompt 22 §2).
 *
 * GET /api/v1/exports/treatment-plan/{planId}?locale=ar
 *
 * Staff surface — SECRETARY/ADMIN any patient, assigned DOCTOR/THERAPIST only,
 * no patient portal access. The rendered PDF carries no patient phone. Every
 * successful export writes a READ_SENSITIVE audit row.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
): Promise<Response> {
  const { planId } = await params;
  const url = new URL(request.url);
  const locale: 'en' | 'ar' = url.searchParams.get('locale') === 'ar' ? 'ar' : 'en';

  const plan = await getPlanById(planId);
  if (!plan) {
    return NextResponse.json({ error: { code: 'TREATMENT_PLAN_NOT_FOUND' } }, { status: 404 });
  }

  try {
    await ensureCanReadPatientStaff(plan.patientId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
    }
    throw err;
  }

  try {
    const { buffer } = await generateTreatmentPlanPdf({ planId, locale });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="treatment-plan-${planId}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: treatmentPlanErrorToLocalized(err) }, { status: 500 });
  }
}
