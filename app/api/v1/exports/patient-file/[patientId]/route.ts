import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { exportErrorToLocalized, generatePatientFilePdf } from '@/lib/exports/patientFile';

/**
 * Patient-file PDF export endpoint (Prompt 11 §4.3).
 *
 * GET /api/v1/exports/patient-file/{patientId}?locale=ar
 *
 * Returns a PDF byte stream. The redaction level is resolved inside
 * `generatePatientFilePdf` from the requester's role + relationship
 * to the patient. Every successful call writes a READ_SENSITIVE
 * audit row via the withAudit wrapper.
 *
 * No streaming response — the document is small (≤ a few pages) and
 * we want the audit row to land only after a complete buffer.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const { patientId } = await params;
  const url = new URL(request.url);
  const locale: 'en' | 'ar' = url.searchParams.get('locale') === 'ar' ? 'ar' : 'en';

  try {
    const { buffer } = await generatePatientFilePdf({
      patientId,
      requester: { id: session.user.id, role: session.user.role },
      locale,
    });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="patient-${patientId}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const localized = exportErrorToLocalized(err);
    const status = localized.code === 'EXPORT_FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: localized }, { status });
  }
}
