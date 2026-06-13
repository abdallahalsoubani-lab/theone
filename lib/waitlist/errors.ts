import type { LocalizedError } from '@/lib/db';

/** Localized error catalogue for the booking waitlist (Prompt 19). */
export const WAITLIST_ERRORS = {
  NOT_FOUND: {
    code: 'WAITLIST_NOT_FOUND',
    message_en: 'This waitlist entry no longer exists.',
    message_ar: 'لم يعد إدخال قائمة الانتظار هذا موجوداً.',
  },
  NOT_WAITING: {
    code: 'WAITLIST_NOT_WAITING',
    message_en: 'This waitlist entry is no longer active.',
    message_ar: 'لم يعد إدخال قائمة الانتظار هذا نشطاً.',
  },
  ALREADY_FULFILLED: {
    code: 'WAITLIST_ALREADY_FULFILLED',
    message_en: 'This waitlist entry was already placed.',
    message_ar: 'تم بالفعل حجز موعد لإدخال قائمة الانتظار هذا.',
  },
} as const satisfies Record<string, LocalizedError>;

export class WaitlistError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'WaitlistError';
  }
}
