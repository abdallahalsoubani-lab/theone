import { NextResponse } from 'next/server';

import { can } from '@/lib/rbac/can';
import {
  generatePediatricAssessmentPdf,
  pedExportErrorToLocalized,
} from '@/lib/exports/pediatricAssessment';
import { getEffectiveSession } from '@/lib/impersonation/session';

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
