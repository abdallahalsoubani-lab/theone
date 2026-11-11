import { NextResponse } from 'next/server';

import { generateHomeProgramPdf, homeProgramErrorToLocalized } from '@/lib/exports/homeProgram';
import { ensureCanReadPatientStaff } from '@/lib/patients/access';
import { ForbiddenError } from '@/lib/rbac/guards';

/**
 * Home-program PDF (P64 #15).
 *
 * GET /api/v1/exports/home-program/{patientId}
 *
 * Staff surface — SECRETARY/ADMIN any patient, assigned DOCTOR/THERAPIST only.
 * Printed in the patient's own language; download only (the clinic hands it
 * over — nothing is sent). Audited as READ_SENSITIVE.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ patientId: string }> },
): Promise<Response> {
  const { patientId } = await params;
  try {
    await ensureCanReadPatientStaff(patientId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
    }
    throw err;
  }

  try {
    const { buffer } = await generateHomeProgramPdf({ patientId });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="home-program-${patientId}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const error = homeProgramErrorToLocalized(err);
    const status =
      error.code === 'HOME_PROGRAM_PATIENT_NOT_FOUND'
        ? 404
        : error.code === 'HOME_PROGRAM_EMPTY'
          ? 422
          : 500;
    return NextResponse.json({ error }, { status });
  }
}
