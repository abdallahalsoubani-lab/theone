import { NextResponse } from 'next/server';

import { ensureCanAccessPatientDocuments } from '@/lib/patient-documents/access';
import { extensionFor } from '@/lib/patient-documents/policy';
import { getDocumentForDownload } from '@/lib/patient-documents/queries';
import { recordDocumentDownload } from '@/lib/patient-documents/services';
import { getObjectBytes } from '@/lib/patient-documents/storage';
import { ForbiddenError } from '@/lib/rbac/guards';

/**
 * Patient-document download (Prompt 22 §3).
 *
 * GET /api/v1/documents/{documentId}
 *
 * Streams the stored object's bytes after enforcing the same visibility as the
 * patient file — SECRETARY/ADMIN any patient; DOCTOR/THERAPIST only assigned
 * patients; the patient portal has no access. Only READY + active documents
 * are downloadable (PENDING / soft-deleted return 404). Every successful
 * download writes a READ_SENSITIVE audit row.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await params;

  const doc = await getDocumentForDownload(documentId);
  if (!doc || doc.status !== 'READY' || !doc.active) {
    return NextResponse.json({ error: { code: 'DOCUMENT_NOT_FOUND' } }, { status: 404 });
  }

  try {
    await ensureCanAccessPatientDocuments(doc.patientId);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
    }
    throw err;
  }

  const bytes = await getObjectBytes(doc.storageKey);
  await recordDocumentDownload({ documentId: doc.id, patientId: doc.patientId });

  // Content-Disposition: the RFC 5987 `filename*` carries the original (possibly
  // Arabic) name; the ASCII `filename` fallback (for clients that ignore
  // `filename*`) now includes the correct extension derived from the stored
  // mime type, so the OS can open it (Fix 6C item 2 — an extensionless fallback
  // saved files the OS couldn't read).
  const encoded = encodeURIComponent(doc.fileName);
  const fallbackName = `document.${extensionFor(doc.mimeType)}`;
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': doc.mimeType,
      'content-disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encoded}`,
      'cache-control': 'no-store',
    },
  });
}
