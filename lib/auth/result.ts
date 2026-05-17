import type { LocalizedError } from '@/lib/db';

/**
 * Result<T, E> — discriminated union shared by every server action.
 *
 * Server actions never throw to the client. They return either { ok: true, data }
 * or { ok: false, error } where `error` is the localized shape from
 * Prompt 0 §5 rule 7. Forms render the localized message; client code branches
 * on the stable machine-readable `error.code`.
 */
export type Result<T, E = LocalizedError> = { ok: true; data: T } | { ok: false; error: E };

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });
export const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Localized error builder for auth-specific cases. Kept here (rather than in
 * `lib/db/errors.ts`) because the codes are auth-flow concerns, not DB errors.
 */
export const AUTH_ERRORS = {
  INVALID_CREDENTIALS: {
    code: 'INVALID_CREDENTIALS',
    message_en: 'Email or password is incorrect.',
    message_ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  },
  INVALID_OTP: {
    code: 'OTP_INVALID',
    message_en: 'The verification code is incorrect.',
    message_ar: 'رمز التحقق غير صحيح.',
  },
  OTP_EXPIRED: {
    code: 'OTP_EXPIRED',
    message_en: 'The verification code has expired. Request a new one.',
    message_ar: 'انتهت صلاحية رمز التحقق. اطلب رمزاً جديداً.',
  },
  OTP_LOCKED: {
    code: 'OTP_LOCKED',
    message_en: 'Too many incorrect codes. Request a new one.',
    message_ar: 'عدد كبير من الرموز الخاطئة. اطلب رمزاً جديداً.',
  },
  OTP_COOLDOWN: {
    code: 'OTP_COOLDOWN',
    message_en: 'Please wait before requesting another code.',
    message_ar: 'يرجى الانتظار قبل طلب رمز جديد.',
  },
  ACCOUNT_LOCKED: {
    code: 'ACCOUNT_LOCKED',
    message_en: 'This account is temporarily locked. Try again in 15 minutes.',
    message_ar: 'هذا الحساب مقفل مؤقتاً. حاول مجدداً بعد 15 دقيقة.',
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message_en: 'Too many attempts. Please slow down.',
    message_ar: 'محاولات كثيرة جداً. يرجى التمهّل.',
  },
  WEAK_PASSWORD: {
    code: 'WEAK_PASSWORD',
    message_en: 'Password must be at least 8 characters with upper, lower, number, and symbol.',
    message_ar: 'يجب أن تحوي كلمة المرور 8 أحرف على الأقل، وحرفاً كبيراً وصغيراً ورقماً ورمزاً.',
  },
  TOKEN_INVALID: {
    code: 'TOKEN_INVALID',
    message_en: 'This reset link is invalid or has expired.',
    message_ar: 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية.',
  },
  UNAUTHENTICATED: {
    code: 'UNAUTHENTICATED',
    message_en: 'Sign-in required.',
    message_ar: 'يلزم تسجيل الدخول.',
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    message_en: 'You do not have permission for this action.',
    message_ar: 'ليست لديك صلاحية لهذا الإجراء.',
  },
} as const satisfies Record<string, LocalizedError>;
