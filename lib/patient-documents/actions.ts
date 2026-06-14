'use server';

import { revalidatePath } from 'next/cache';

import { fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import { ensureCanAccessPatientDocuments } from './access';
import { DOC_ERRORS, docToLocalized } from './errors';
import { getDocumentForDownload } from './queries';
import { createTicketSchema, deleteDocumentSchema, finalizeSchema } from './schemas';
import { createPendingDocument, finalizeDocument, softDeleteDocument } from './services';
import type { UploadTicket } from './services';

function revalidate(): void {
  revalidatePath('/[locale]/(staff)/secretary/patients/[id]', 'page');
  revalidatePath('/[locale]/(staff)/doctor/patients/[id]', 'page');
  revalidatePath('/[locale]/(staff)/therapist/patients/[id]', 'page');
}

/** Step 1 — create the PENDING row + presigned PUT URL. */
export async function createDocumentUploadTicket(input: unknown): Promise<Result<UploadTicket>> {
  await requirePermission('patient_documents.upload');
  const parsed = createTicketSchema.safeParse(input);
  if (!parsed.success) return fail(docToLocalized(parsed.error));
  try {
    await ensureCanAccessPatientDocuments(parsed.data.patientId);
    const { documentId, uploadUrl, expiresInSeconds } = await createPendingDocument(parsed.data);
    return ok({ documentId, uploadUrl, expiresInSeconds });
  } catch (err) {
    return fail(docToLocalized(err));
  }
}

/** Step 2 — after the browser PUT, confirm the bytes and reveal (or reject). */
export async function finalizeDocumentUpload(
  input: unknown,
): Promise<Result<{ documentId: string }>> {
  await requirePermission('patient_documents.upload');
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return fail(docToLocalized(parsed.error));
  try {
    const doc = await getDocumentForDownload(parsed.data.documentId);
    if (!doc) return fail(DOC_ERRORS.NOT_FOUND);
    await ensureCanAccessPatientDocuments(doc.patientId);
    const result = await finalizeDocument({ documentId: parsed.data.documentId });
    if (result.outcome === 'REJECTED') return fail(DOC_ERRORS.SNIFF_FAILED);
    revalidate();
    return ok({ documentId: result.documentId });
  } catch (err) {
    return fail(docToLocalized(err));
  }
}

/** Soft-delete (hide) a document; the stored object is retained. */
export async function deleteDocument(input: unknown): Promise<Result<{ documentId: string }>> {
  await requirePermission('patient_documents.delete');
  const parsed = deleteDocumentSchema.safeParse(input);
  if (!parsed.success) return fail(docToLocalized(parsed.error));
  try {
    const doc = await getDocumentForDownload(parsed.data.documentId);
    if (!doc) return fail(DOC_ERRORS.NOT_FOUND);
    await ensureCanAccessPatientDocuments(doc.patientId);
    const result = await softDeleteDocument({ documentId: parsed.data.documentId });
    revalidate();
    return ok({ documentId: result.documentId });
  } catch (err) {
    return fail(docToLocalized(err));
  }
}
