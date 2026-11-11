import { NextResponse } from 'next/server';

import { can } from '@/lib/rbac/can';
import {
  generatePediatricAssessmentPdf,
  pedExportErrorToLocalized,
} from '@/lib/exports/pediatricAssessment';
import { getEffectiveSession } from '@/lib/impersonation/session';
import { ensureCanReadPatientStaff } from '@/lib/patients/access';
import { getAssessmentById } from '@/lib/pediatric-assessment/queries';
import { ForbiddenError } from '@/lib/rbac/guards';

/**
 * Pediatric assessment PDF export (Prompt 21 §5).
 *
 * GET /api/v1/exports/pediatric-assessment/{assessmentId}?locale=ar
 *
 * Clinical content — gated on `pediatric_assessment.read.assigned`
 * (DOCTOR/THERAPIST; ADMIN via the universal-read bypass). SECRETARY + PATIENT
 * have no access. Every successful export writes a READ_SENSITIVE audit row.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ assessmentId: string }> },
): Promise<Response> {
  const session = await getEffectiveSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }
  if (!can(session.user, 'pediatric_assessment.read.assigned', {})) {
    return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  }

  const { assessmentId } = await params;
  const url = new URL(request.url);
  const locale: 'en' | 'ar' = url.searchParams.get('locale') === 'ar' ? 'ar' : 'en';

  // Care-team gate (P64 #16): the permission above is unscoped, so a
  // DOCTOR/THERAPIST must also be on this patient's care team.
  const assessment = await getAssessmentById(assessmentId);
  if (!assessment) {
    return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  }
  try {
    await ensureCanReadPatientStaff(assessment.patientId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
    }
    throw err;
  }

  try {
    const { buffer } = await generatePediatricAssessmentPdf({ assessmentId, locale });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="pediatric-assessment-${assessmentId}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const localized = pedExportErrorToLocalized(err);
    return NextResponse.json({ error: localized }, { status: 500 });
  }
}
