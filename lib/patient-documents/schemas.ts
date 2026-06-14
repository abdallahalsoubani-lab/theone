import { DocumentCategory } from '@prisma/client';
import { z } from 'zod';

import { PATIENT_DOC_MAX_BYTES, PATIENT_DOC_MIME_TYPES } from './policy';

export const createTicketSchema = z.object({
  patientId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  category: z.nativeEnum(DocumentCategory),
  note: z.string().trim().max(1000).optional(),
  contentType: z.enum(PATIENT_DOC_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(PATIENT_DOC_MAX_BYTES),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const finalizeSchema = z.object({ documentId: z.string().min(1) });
export type FinalizeInput = z.infer<typeof finalizeSchema>;

export const deleteDocumentSchema = z.object({ documentId: z.string().min(1) });
export type DeleteDocumentInput = z.infer<typeof deleteDocumentSchema>;
