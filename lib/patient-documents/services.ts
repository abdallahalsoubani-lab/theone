import { randomUUID } from 'node:crypto';

import { AuditAction, UserRole } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';

import { PatientDocumentError, DOC_ERRORS } from './errors';
import { buildDocumentKey, validatePatientDocInput } from './policy';
import type { CreateTicketInput } from './schemas';
import { sniffMatchesDeclared } from './sniff';
import { deleteObject, getObjectHeadBytes, presignDocumentPut, SIGN_TTL_SECONDS } from './storage';

export interface UploadTicket {
  documentId: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

/**
 * Create the PENDING document row and a presigned PUT URL (Prompt 22 §3). The
 * row is born PENDING and therefore invisible to every list/download query
 * until `finalizeDocument` confirms the bytes with a server-side sniff — so a
 * failed or malicious upload never surfaces, even briefly. The storage key is
 * opaque and patient-scoped; the original filename is never used in the key.
 */
export const createPendingDocument = withAudit<
  [CreateTicketInput],
  UploadTicket & { patientId: string }
>(
  {
    entityType: 'PatientDocument',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.documentId,
    extractAfter: (result) => ({ event: 'DOCUMENT_UPLOAD_STARTED', id: result.documentId }),
  },
  async function createInner(input): Promise<UploadTicket & { patientId: string }> {
    const session = await auth();
    if (!session?.user?.id) throw new PatientDocumentError(DOC_ERRORS.UNAUTHENTICATED);

    const validationError = validatePatientDocInput({
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
    if (validationError) {
      throw new PatientDocumentError(
        validationError.code === 'TOO_LARGE' ? DOC_ERRORS.TOO_LARGE : DOC_ERRORS.UNSUPPORTED_TYPE,
      );
    }

    const patient = await db.user.findUnique({
      where: { id: input.patientId },
      select: { id: true, role: true },
    });
    if (!patient || patient.role !== UserRole.PATIENT) {
      throw new PatientDocumentError(DOC_ERRORS.PATIENT_NOT_FOUND);
    }

    const id = randomUUID();
    const storageKey = buildDocumentKey(input.patientId, input.contentType, id);

    await db.patientDocument.create({
      data: {
        id,
        patientId: input.patientId,
        fileName: input.fileName,
        storageKey,
        mimeType: input.contentType,
        sizeBytes: input.sizeBytes,
        category: input.category,
        note: input.note ?? null,
        uploadedById: session.user.id,
        // status defaults to PENDING
      },
    });

    const uploadUrl = await presignDocumentPut({
      key: storageKey,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });

    return {
      documentId: id,
      patientId: input.patientId,
      uploadUrl,
      expiresInSeconds: SIGN_TTL_SECONDS,
    };
  },
);

/**
 * Records a READ_SENSITIVE audit row for a document download (Prompt 22). The
 * route reads + streams the bytes; this wrapper exists solely to capture the
 * audited "who downloaded what" event after access has been authorized.
 */
export const recordDocumentDownload = withAudit<
  [{ documentId: string; patientId: string }],
  { documentId: string }
>(
  {
    entityType: 'PatientDocument',
    action: AuditAction.READ_SENSITIVE,
    extractEntityId: (args) => args[0].documentId,
    extractAfter: () => ({ event: 'DOCUMENT_DOWNLOADED' }),
  },
  async function recordInner(input): Promise<{ documentId: string }> {
    return { documentId: input.documentId };
  },
);

export interface FinalizeResult {
  documentId: string;
  patientId: string;
  outcome: 'READY' | 'REJECTED';
}

/**
 * Confirm a PENDING upload by sniffing the stored object's magic bytes
 * (Prompt 22 §3). A match flips the row to READY (now visible/downloadable). A
 * mismatch — a spoofed type, a renamed executable, a truncated upload — deletes
 * BOTH the stored object and the row, so the rejected upload leaves no trace.
 * Never throws on a content mismatch; returns `outcome: 'REJECTED'` so the
 * rejection is still captured by the audit decorator.
 */
export const finalizeDocument = withAudit<[{ documentId: string }], FinalizeResult>(
  {
    entityType: 'PatientDocument',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].documentId,
    extractAfter: (result) => ({ event: `DOCUMENT_${result.outcome}` }),
  },
  async function finalizeInner(input): Promise<FinalizeResult> {
    const doc = await db.patientDocument.findUnique({
      where: { id: input.documentId },
      select: { id: true, patientId: true, storageKey: true, mimeType: true, status: true },
    });
    if (!doc) throw new PatientDocumentError(DOC_ERRORS.NOT_FOUND);

    // Already finalized — idempotent no-op.
    if (doc.status === 'READY') {
      return { documentId: doc.id, patientId: doc.patientId, outcome: 'READY' };
    }

    const head = await getObjectHeadBytes(doc.storageKey, 32);
    const matches = sniffMatchesDeclared(doc.mimeType, head);

    if (!matches) {
      // Purge the object first, then the row. If the object delete fails we
      // still drop the row so it never becomes visible; the orphaned object is
      // harmless (unreferenced, opaque key).
      try {
        await deleteObject(doc.storageKey);
      } catch (err) {
        console.error('[patient-documents] failed to delete rejected object', err);
      }
      await db.patientDocument.delete({ where: { id: doc.id } });
      return { documentId: doc.id, patientId: doc.patientId, outcome: 'REJECTED' };
    }

    await db.patientDocument.update({
      where: { id: doc.id },
      data: { status: 'READY' },
    });
    return { documentId: doc.id, patientId: doc.patientId, outcome: 'READY' };
  },
);

/**
 * Soft-delete a document (Prompt 22). Flips `active=false` so it disappears
 * from every list and download path; the stored object is intentionally KEPT
 * so an accidental delete is recoverable by an admin.
 */
export const softDeleteDocument = withAudit<
  [{ documentId: string }],
  { documentId: string; patientId: string }
>(
  {
    entityType: 'PatientDocument',
    action: AuditAction.DELETE,
    extractEntityId: (args) => args[0].documentId,
    extractAfter: () => ({ event: 'DOCUMENT_SOFT_DELETED' }),
  },
  async function deleteInner(input): Promise<{ documentId: string; patientId: string }> {
    const doc = await db.patientDocument.findUnique({
      where: { id: input.documentId },
      select: { id: true, patientId: true, active: true },
    });
    if (!doc) throw new PatientDocumentError(DOC_ERRORS.NOT_FOUND);

    if (doc.active) {
      await db.patientDocument.update({
        where: { id: doc.id },
        data: { active: false },
      });
    }
    return { documentId: doc.id, patientId: doc.patientId };
  },
);
