import { toLocalizedError, type LocalizedError } from '@/lib/db';

export const DOC_ERRORS = {
  NOT_FOUND: {
    code: 'DOCUMENT_NOT_FOUND',
    message_en: 'This document no longer exists.',
    message_ar: 'لم يعد هذا المستند موجوداً.',
  },
  PATIENT_NOT_FOUND: {
    code: 'DOCUMENT_PATIENT_NOT_FOUND',
    message_en: 'Patient not found.',
    message_ar: 'لم يتم العثور على المراجع.',
  },
  UNSUPPORTED_TYPE: {
    code: 'DOCUMENT_UNSUPPORTED_TYPE',
    message_en: 'Only PDF and image files (JPEG, PNG, WebP, HEIC) are allowed.',
    message_ar: 'يُسمح بملفات PDF والصور فقط (JPEG وPNG وWebP وHEIC).',
  },
  TOO_LARGE: {
    code: 'DOCUMENT_TOO_LARGE',
    message_en: 'The file exceeds the 20 MB limit.',
    message_ar: 'يتجاوز حجم الملف الحد المسموح به وهو 20 ميغابايت.',
  },
  SNIFF_FAILED: {
    code: 'DOCUMENT_SNIFF_FAILED',
    message_en: 'The uploaded file did not match its declared type and was rejected.',
    message_ar: 'لم يطابق الملف المرفوع نوعه المُعلن وتم رفضه.',
  },
  UNAUTHENTICATED: {
    code: 'UNAUTHENTICATED',
    message_en: 'Sign-in required.',
    message_ar: 'يلزم تسجيل الدخول.',
  },
} as const satisfies Record<string, LocalizedError>;

export class PatientDocumentError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'PatientDocumentError';
  }
}

export function docToLocalized(err: unknown): LocalizedError {
  if (err instanceof PatientDocumentError) return err.error;
  return toLocalizedError(err);
}
