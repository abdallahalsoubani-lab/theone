import { toLocalizedError, type LocalizedError } from '@/lib/db';

export const SUBMISSION_ERRORS = {
  NOT_FOUND: {
    code: 'INTAKE_SUBMISSION_NOT_FOUND',
    message_en: 'This submission no longer exists.',
    message_ar: 'لم يعد هذا الطلب موجوداً.',
  },
  ALREADY_REVIEWED: {
    code: 'INTAKE_SUBMISSION_ALREADY_REVIEWED',
    message_en: 'This submission has already been reviewed.',
    message_ar: 'تمت مراجعة هذا الطلب بالفعل.',
  },
  INVALID_PHONE: {
    code: 'INTAKE_SUBMISSION_INVALID_PHONE',
    message_en: 'Enter a valid Jordan mobile number (e.g. 079 / 078 / 077).',
    message_ar: 'أدخل رقم هاتف أردني صحيح (مثال: 079 / 078 / 077).',
  },
  RATE_LIMITED: {
    code: 'INTAKE_SUBMISSION_RATE_LIMITED',
    message_en: 'Too many submissions from this device. Please try again later.',
    message_ar: 'عدد كبير من الطلبات من هذا الجهاز. يرجى المحاولة لاحقاً.',
  },
  TOO_LARGE: {
    code: 'INTAKE_SUBMISSION_TOO_LARGE',
    message_en: 'The submission is too large.',
    message_ar: 'حجم الطلب كبير جداً.',
  },
  LINK_TARGET_INVALID: {
    code: 'INTAKE_SUBMISSION_LINK_TARGET_INVALID',
    message_en: 'The selected patient cannot be linked to this submission.',
    message_ar: 'لا يمكن ربط المراجع المحدد بهذا الطلب.',
  },
  UNAUTHENTICATED: {
    code: 'UNAUTHENTICATED',
    message_en: 'Sign-in required.',
    message_ar: 'يلزم تسجيل الدخول.',
  },
} as const satisfies Record<string, LocalizedError>;

export class IntakeSubmissionError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'IntakeSubmissionError';
  }
}

export function submissionToLocalized(err: unknown): LocalizedError {
  if (err instanceof IntakeSubmissionError) return err.error;
  return toLocalizedError(err);
}
