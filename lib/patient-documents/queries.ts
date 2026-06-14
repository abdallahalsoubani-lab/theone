import type { DocumentCategory } from '@prisma/client';

import { db } from '@/lib/db';

export interface DocumentListRow {
  id: string;
  fileName: string;
  category: DocumentCategory;
  mimeType: string;
  sizeBytes: number;
  note: string | null;
  createdAt: string; // ISO
  uploadedByNameEn: string;
  uploadedByNameAr: string;
}

/**
 * List a patient's downloadable documents (Prompt 22). Only READY (sniff-
 * confirmed) and active (not soft-deleted) rows — PENDING and deleted rows are
 * never exposed. The opaque storage key is deliberately NOT returned; download
 * goes through the can()-gated route by document id.
 */
export async function listDocuments(patientId: string): Promise<DocumentListRow[]> {
  const rows = await db.patientDocument.findMany({
    where: { patientId, status: 'READY', active: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      category: true,
      mimeType: true,
      sizeBytes: true,
      note: true,
      createdAt: true,
      uploadedBy: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    category: r.category,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    uploadedByNameEn: r.uploadedBy.fullNameEn,
    uploadedByNameAr: r.uploadedBy.fullNameAr,
  }));
}

export interface DocumentDownloadMeta {
  id: string;
  patientId: string;
  storageKey: string;
  mimeType: string;
  fileName: string;
  status: 'PENDING' | 'READY';
  active: boolean;
}

/** Fetch the metadata the download route needs (including the storage key). */
export async function getDocumentForDownload(
  documentId: string,
): Promise<DocumentDownloadMeta | null> {
  const r = await db.patientDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      patientId: true,
      storageKey: true,
      mimeType: true,
      fileName: true,
      status: true,
      active: true,
    },
  });
  if (!r) return null;
  return r;
}
