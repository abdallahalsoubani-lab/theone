/**
 * Patient-document upload constraints (Prompt 22 §3). Images + PDF only, 20 MB
 * max. No docx for v1 — a docx is a ZIP container, so a magic-byte sniff can't
 * cleanly distinguish it from other zips / zipped executables; adding it later
 * is easy if the clinic asks.
 */

export const PATIENT_DOC_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export const PATIENT_DOC_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export type PatientDocMime = (typeof PATIENT_DOC_MIME_TYPES)[number];

export function isAllowedMime(ct: string): ct is PatientDocMime {
  return (PATIENT_DOC_MIME_TYPES as readonly string[]).includes(ct);
}

export function extensionFor(ct: string): string {
  switch (ct) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    default:
      return 'bin';
  }
}

export interface PatientDocValidationError {
  code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE';
  message: string;
}

export function validatePatientDocInput(args: {
  contentType: string;
  sizeBytes: number;
}): PatientDocValidationError | null {
  if (!isAllowedMime(args.contentType)) {
    return {
      code: 'UNSUPPORTED_TYPE',
      message: `Content type ${args.contentType} is not allowed.`,
    };
  }
  if (args.sizeBytes <= 0 || args.sizeBytes > PATIENT_DOC_MAX_BYTES) {
    return { code: 'TOO_LARGE', message: `Size ${args.sizeBytes} exceeds the 20 MB limit.` };
  }
  return null;
}

/** Opaque, patient-scoped key: `patients/{patientId}/documents/{id}.{ext}`. */
export function buildDocumentKey(patientId: string, contentType: string, id: string): string {
  return `patients/${patientId}/documents/${id}.${extensionFor(contentType)}`;
}
