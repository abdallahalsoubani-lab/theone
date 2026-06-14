import { NextResponse } from 'next/server';

import { getSessionNoteById } from '@/lib/clinical/session-notes/queries';
import {
  generateSessionReportPdf,
  sessionReportErrorToLocalized,
} from '@/lib/exports/sessionReport';
import { ensureCanReadPatientStaff } from '@/lib/patients/access';
import { ForbiddenError } from '@/lib/rbac/guards';

/**
 * Session report PDF export (Prompt 22 §2).
 *
 * GET /api/v1/exports/session-report/{noteId}?locale=ar
 *
 * Staff surface — SECRETARY/ADMIN any patient, assigned DOCTOR/THERAPIST only,
 * no patient portal access. The rendered PDF carries no patient phone. Every
 * successful export writes a READ_SENSITIVE audit row.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> },
): Promise<Response> {
  const { noteId } = await params;
  const url = new URL(request.url);
  const locale: 'en' | 'ar' = url.searchParams.get('locale') === 'ar' ? 'ar' : 'en';

  const note = await getSessionNoteById(noteId);
  if (!note) {
    return NextResponse.json({ error: { code: 'SESSION_NOTE_NOT_FOUND' } }, { status: 404 });
  }

  try {
    await ensureCanReadPatientStaff(note.patientId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
    }
    throw err;
  }

  try {
    const { buffer } = await generateSessionReportPdf({ noteId, locale });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="session-report-${noteId}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: sessionReportErrorToLocalized(err) }, { status: 500 });
  }
}
