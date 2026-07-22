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

/** Extensions consistent with each allowed MIME type (Prompt 32 §3.4). A
 *  filename with no extension passes — the storage key is server-built from
 *  the MIME type, and the magic-byte sniff still guards the actual bytes. */
const DOC_EXTENSIONS_FOR_TYPE: Record<PatientDocMime, ReadonlyArray<string>> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif', 'heic'],
};

export function docExtensionMatchesType(fileName: string, contentType: PatientDocMime): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return true;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return DOC_EXTENSIONS_FOR_TYPE[contentType].includes(ext);
}

export interface PatientDocValidationError {
  code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE';
  message: string;
}

export function validatePatientDocInput(args: {
  contentType: string;
  sizeBytes: number;
  /** Original filename — extension must not contradict the declared type. */
  fileName?: string;
}): PatientDocValidationError | null {
  if (!isAllowedMime(args.contentType)) {
    return {
      code: 'UNSUPPORTED_TYPE',
      message: `Content type ${args.contentType} is not allowed.`,
    };
  }
  if (args.fileName && !docExtensionMatchesType(args.fileName, args.contentType)) {
    return {
      code: 'UNSUPPORTED_TYPE',
      message: `File extension of "${args.fileName}" does not match ${args.contentType}.`,
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
