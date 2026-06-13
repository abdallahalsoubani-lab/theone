import type { LocalizedError } from '@/lib/db';

export const PED_ERRORS = {
  NOT_FOUND: {
    code: 'PED_ASSESSMENT_NOT_FOUND',
    message_en: 'This assessment no longer exists.',
    message_ar: 'لم يعد هذا التقييم موجوداً.',
  },
  PATIENT_NOT_FOUND: {
    code: 'PED_PATIENT_NOT_FOUND',
    message_en: 'Patient not found.',
    message_ar: 'لم يتم العثور على المراجع.',
  },
  FIELD_NOT_FOUND: {
    code: 'PED_FIELD_NOT_FOUND',
    message_en: 'This custom field no longer exists.',
    message_ar: 'لم يعد هذا الحقل المخصص موجوداً.',
  },
  UNAUTHENTICATED: {
    code: 'UNAUTHENTICATED',
    message_en: 'Sign-in required.',
    message_ar: 'يلزم تسجيل الدخول.',
  },
} as const satisfies Record<string, LocalizedError>;

export class PedAssessmentError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'PedAssessmentError';
  }
}
